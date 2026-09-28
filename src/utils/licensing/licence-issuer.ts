import { createPrivateKey, KeyObject, sign as cryptoSign } from 'crypto';

/**
 * Mints Tenantry.Pro licence keys.
 *
 * A licence is a standard JWS/JWT signed with ES256 (RFC 7518 §3.4): the signature is the 64-byte r‖s
 * concatenation (IEEE P1363), which Node's crypto produces with `dsaEncoding: 'ieee-p1363'` and which any
 * JWT library verifies. Tenantry.Pro's `LicenseValidator` verifies exactly this encoding, and
 * `licence-contract.json` pins it between the two repos.
 *
 * The private key lives ONLY in the portal's secret store as `LICENCE_SIGNING_PRIVATE_KEY`
 * (PKCS#8 PEM). The matching public half is embedded in the published `Tenantry.Pro` package.
 */

const ISSUER = 'Tenantry';

export interface LicenceClaims {
  /** Paddle customer id — becomes the JWT `sub`. */
  customerId: string;
  /** Entitlement tier (e.g. "pro"). */
  tier: string;
  /** When the licence expires (`exp`). Track the subscription period end; the 30-day runtime grace covers renewal gaps. */
  expiresAt: Date;
  /** Optional seat count (`seats`). Omitted from the token when undefined. */
  seats?: number;
  /** Optional not-before (`nbf`). Defaults to now. */
  notBefore?: Date;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function loadSigningKey(): KeyObject {
  const pem = process.env.LICENCE_SIGNING_PRIVATE_KEY;

  if (!pem) {
    throw new Error(
      'LICENCE_SIGNING_PRIVATE_KEY is not configured. Set the P-256 PKCS#8 private key (matching the ' +
        'VendorPublicKey embedded in Tenantry.Pro) in the portal secret store.',
    );
  }

  return createPrivateKey(pem);
}

/**
 * Signs a Tenantry.Pro licence (ES256) and returns the compact JWT string.
 *
 * @param claims The licence claims.
 * @param signingKey Optional pre-loaded key (used in tests). Defaults to `LICENCE_SIGNING_PRIVATE_KEY`.
 */
export function issueLicence(claims: LicenceClaims, signingKey?: KeyObject): string {
  const key = signingKey ?? loadSigningKey();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = base64Url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: ISSUER,
      sub: claims.customerId,
      tier: claims.tier,
      ...(claims.seats != null ? { seats: claims.seats } : {}),
      iat: nowSeconds,
      nbf: Math.floor((claims.notBefore ?? new Date()).getTime() / 1000),
      exp: Math.floor(claims.expiresAt.getTime() / 1000),
    }),
  );

  const signingInput = `${header}.${payload}`;
  // JWS ES256 signatures are r‖s (IEEE P1363), not Node's default DER encoding.
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'ascii'), { key, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64Url(signature)}`;
}
