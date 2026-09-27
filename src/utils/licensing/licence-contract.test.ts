import {
  createECDH,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueLicence, type LicenceClaims } from './licence-issuer';

/**
 * The licence format contract between this site (which signs licences) and Tenantry.Pro (which verifies them).
 *
 * `licence-contract.json` holds a token signed by `issueLicence` with a TEST key, the claims it was signed
 * with, and the test public key. An identical copy lives in the Pro repo
 * (tests/Tenantry.Pro.Tests/Licensing/Fixtures/licence-contract.json), where the real LicenseValidator must
 * accept the token and reject a P1363 re-signature. So a format change on either side breaks a test:
 *   - here, if `issueLicence` changes its header, claims, serialisation or signature encoding;
 *   - in Pro, if the validator stops accepting what the site signs.
 *
 * After an intentional format change, regenerate the fixture and copy it to Pro:
 *   UPDATE_LICENCE_CONTRACT=1 pnpm vitest run src/utils/licensing/licence-contract.test.ts
 *
 * The test key is derived from a public seed, so it is not a secret and never valid for real licences.
 */

const fixturePath = fileURLToPath(new URL('./licence-contract.json', import.meta.url));
const contractSeed = 'tenantry-licence-contract-test-key-v1';

interface LicenceContract {
  note: string;
  publicKeySpki: string;
  issuedAt: string;
  claims: { customerId: string; tier: string; seats: number; notBefore: string; expiresAt: string };
  token: string;
}

function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '='), 'base64');
}

function contractTestKey() {
  const d = createHash('sha256').update(contractSeed).digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', x: base64Url(point.subarray(1, 33)), y: base64Url(point.subarray(33)) };

  return {
    privateKey: createPrivateKey({ key: { ...jwk, d: base64Url(d) }, format: 'jwk' }),
    publicKey: createPublicKey({ key: jwk, format: 'jwk' }),
  };
}

function toLicenceClaims(claims: LicenceContract['claims']): LicenceClaims {
  return {
    customerId: claims.customerId,
    tier: claims.tier,
    seats: claims.seats,
    notBefore: new Date(claims.notBefore),
    expiresAt: new Date(claims.expiresAt),
  };
}

function issueAt(issuedAt: string, claims: LicenceContract['claims']): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(issuedAt));

  try {
    return issueLicence(toLicenceClaims(claims), contractTestKey().privateKey);
  } finally {
    vi.useRealTimers();
  }
}

function verifies(token: string, dsaEncoding: 'der' | 'ieee-p1363'): boolean {
  const [header, payload, signature] = token.split('.');

  return cryptoVerify(
    'sha256',
    Buffer.from(`${header}.${payload}`, 'ascii'),
    { key: contractTestKey().publicKey, dsaEncoding },
    base64UrlDecode(signature),
  );
}

describe('licence format contract with Tenantry.Pro', () => {
  afterEach(() => vi.useRealTimers());

  if (process.env.UPDATE_LICENCE_CONTRACT === '1') {
    it('regenerates licence-contract.json', () => {
      const issuedAt = '2026-09-27T00:00:00.000Z';
      const claims = {
        customerId: 'ctm_contract',
        tier: 'pro',
        seats: 3,
        notBefore: issuedAt,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
      const contract: LicenceContract = {
        note:
          'Licence format contract between tenantry-site and Tenantry.Pro. Signed with a TEST key derived from a ' +
          'public seed; not valid for any real licence. Keep identical to the copy in the other repo.',
        publicKeySpki: contractTestKey().publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        issuedAt,
        claims,
        token: issueAt(issuedAt, claims),
      };

      writeFileSync(fixturePath, `${JSON.stringify(contract, null, 2)}\n`);
    });

    return;
  }

  const contract = JSON.parse(readFileSync(fixturePath, 'utf8')) as LicenceContract;

  it('uses the test key the Pro copy verifies with', () => {
    const spki = contractTestKey().publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    expect(spki).toBe(contract.publicKeySpki);
  });

  it('issues the same header and claims, byte for byte, as the contract token', () => {
    const [header, payload] = issueAt(contract.issuedAt, contract.claims).split('.');
    const [contractHeader, contractPayload] = contract.token.split('.');

    expect(header).toBe(contractHeader);
    expect(payload).toBe(contractPayload);
  });

  it('signs with a DER-encoded ES256 signature, which is what Pro verifies', () => {
    const token = issueAt(contract.issuedAt, contract.claims);

    expect(verifies(token, 'der')).toBe(true);
    expect(verifies(contract.token, 'der')).toBe(true);
  });

  it('does not produce the JOSE-standard P1363 signature, which Pro rejects', () => {
    const [header, payload] = contract.token.split('.');
    const p1363 = cryptoSign('sha256', Buffer.from(`${header}.${payload}`, 'ascii'), {
      key: contractTestKey().privateKey,
      dsaEncoding: 'ieee-p1363',
    });

    expect(verifies(contract.token, 'ieee-p1363')).toBe(false);
    expect(verifies(`${header}.${payload}.${base64Url(p1363)}`, 'der')).toBe(false);
  });
});
