import 'server-only';
import { createHash, createPublicKey, KeyObject, sign as cryptoSign } from 'crypto';
import { serverConfig } from '@/server/config/server-config';

/**
 * Mints Tenantry.Pro licence keys.
 *
 * A licence is a standard JWS/JWT signed with ES256 (RFC 7518 §3.4): the signature is the 64-byte r‖s
 * concatenation (IEEE P1363), which Node's crypto produces with `dsaEncoding: 'ieee-p1363'` and which any
 * JWT library verifies. Its header names the signing key (`kid`, the key's RFC 7638 JWK thumbprint), and its
 * claims name the issuer (`iss`), the product (`aud`) and the licence format (`ver`). Tenantry.Pro requires all
 * three and finds the public key by `kid` among those it embeds, so a new signing key can be added without
 * invalidating licences already issued. `licence-contract.json` pins the format between the two repos.
 *
 * A licence does not expire: it has no `exp`, and Tenantry.Pro accepts any key it can verify. A customer is
 * issued one when their access starts and keeps it; the subscription gates the private package feed (and so
 * new versions), not the key.
 *
 * The private key lives ONLY in the portal's secret store as `LICENCE_SIGNING_PRIVATE_KEY` (PKCS#8 PEM), checked
 * when the server starts (server-config.ts). The matching public half is embedded in the published `Tenantry.Pro`
 * package.
 */

const ISSUER = 'Tenantry';
const AUDIENCE = 'tenantry-pro';
/** The licence format. Tenantry.Pro refuses a format it does not know, so change it only with a Pro release that reads it. */
const FORMAT_VERSION = 1;

export interface LicenceClaims {
  /** Paddle customer id — becomes the JWT `sub`. */
  customerId: string;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * The key id of a P-256 key: its RFC 7638 JWK thumbprint, the base64url SHA-256 of its required JWK members in
 * lexicographic order. Tenantry.Pro computes the same id from each public key it embeds.
 */
export function licenceKeyId(key: KeyObject): string {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  const { crv, x, y } = publicKey.export({ format: 'jwk' });

  return createHash('sha256')
    .update(JSON.stringify({ crv, kty: 'EC', x, y }))
    .digest('base64url');
}

/**
 * Signs a Tenantry.Pro licence (ES256) and returns the compact JWT string.
 *
 * @param claims The licence claims.
 * @param key The signing key; by default, this environment's (`LICENCE_SIGNING_PRIVATE_KEY`).
 */
export function issueLicence(claims: LicenceClaims, key: KeyObject = serverConfig().licenceSigningKey): string {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = base64Url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: licenceKeyId(key) }));
  const payload = base64Url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      ver: FORMAT_VERSION,
      sub: claims.customerId,
      iat: nowSeconds,
    }),
  );

  const signingInput = `${header}.${payload}`;
  // JWS ES256 signatures are r‖s (IEEE P1363), not Node's default DER encoding.
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'ascii'), { key, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64Url(signature)}`;
}
