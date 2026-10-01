import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { calculateJwkThumbprint, exportJWK, jwtVerify } from 'jose';
import { issueLicence, licenceKeyId } from './licence-issuer';

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

describe('issueLicence', () => {
  it('produces a standard ES256 JWT that a JWT library verifies against the matching public key', async () => {
    const token = issueLicence({ customerId: 'ctm_123' }, privateKey);

    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: ['ES256'],
      issuer: 'Tenantry',
      audience: 'tenantry-pro',
    });

    expect(protectedHeader).toEqual({ alg: 'ES256', typ: 'JWT', kid: licenceKeyId(privateKey) });
    expect(payload.sub).toBe('ctm_123');
    // RFC 7518 §3.4: an ES256 signature is r‖s, two 32-byte integers.
    expect(base64UrlDecode(token.split('.')[2])).toHaveLength(64);
  });

  it('writes the issuer, audience, format, customer and issue time, and no expiry: licences do not expire', () => {
    const token = issueLicence({ customerId: 'ctm_123' }, privateKey);
    const claims = JSON.parse(base64UrlDecode(token.split('.')[1]).toString());

    expect(Object.keys(claims).sort()).toEqual(['aud', 'iat', 'iss', 'sub', 'ver']);
    expect(claims).toMatchObject({ iss: 'Tenantry', aud: 'tenantry-pro', ver: 1, sub: 'ctm_123' });
  });

  it('names the signing key by its RFC 7638 JWK thumbprint', async () => {
    // jose's thumbprint, an implementation independent of the issuer's.
    expect(licenceKeyId(privateKey)).toBe(await calculateJwkThumbprint(await exportJWK(publicKey), 'sha256'));
    expect(licenceKeyId(publicKey)).toBe(licenceKeyId(privateKey));
  });

  it('throws a clear error when no signing key is configured', () => {
    const previous = process.env.LICENCE_SIGNING_PRIVATE_KEY;
    delete process.env.LICENCE_SIGNING_PRIVATE_KEY;

    try {
      expect(() => issueLicence({ customerId: 'ctm_123' })).toThrow(/LICENCE_SIGNING_PRIVATE_KEY/);
    } finally {
      if (previous !== undefined) process.env.LICENCE_SIGNING_PRIVATE_KEY = previous;
    }
  });
});
