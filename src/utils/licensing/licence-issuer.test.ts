import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { jwtVerify } from 'jose';
import { issueLicence } from './licence-issuer';

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

describe('issueLicence', () => {
  it('produces a standard ES256 JWT that a JWT library verifies against the matching public key', async () => {
    const token = issueLicence(
      { customerId: 'ctm_123', tier: 'pro', seats: 5, expiresAt: new Date(Date.now() + 3_600_000) },
      privateKey,
    );

    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: ['ES256'],
      issuer: 'Tenantry',
    });

    expect(protectedHeader).toEqual({ alg: 'ES256', typ: 'JWT' });
    expect(payload.sub).toBe('ctm_123');
    // RFC 7518 §3.4: an ES256 signature is r‖s, two 32-byte integers.
    expect(base64UrlDecode(token.split('.')[2])).toHaveLength(64);
  });

  it('writes the expected claims', () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const token = issueLicence({ customerId: 'ctm_123', tier: 'pro', seats: 5, expiresAt }, privateKey);
    const claims = JSON.parse(base64UrlDecode(token.split('.')[1]).toString());

    expect(claims.iss).toBe('Tenantry');
    expect(claims.sub).toBe('ctm_123');
    expect(claims.tier).toBe('pro');
    expect(claims.seats).toBe(5);
    expect(claims.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
    expect(claims.nbf).toBeLessThanOrEqual(claims.iat);
  });

  it('omits seats when not provided', () => {
    const token = issueLicence(
      { customerId: 'ctm_123', tier: 'pro', expiresAt: new Date(Date.now() + 1000) },
      privateKey,
    );
    const claims = JSON.parse(base64UrlDecode(token.split('.')[1]).toString());

    expect(claims).not.toHaveProperty('seats');
  });

  it('throws a clear error when no signing key is configured', () => {
    const previous = process.env.LICENCE_SIGNING_PRIVATE_KEY;
    delete process.env.LICENCE_SIGNING_PRIVATE_KEY;

    try {
      expect(() => issueLicence({ customerId: 'ctm_123', tier: 'pro', expiresAt: new Date() })).toThrow(
        /LICENCE_SIGNING_PRIVATE_KEY/,
      );
    } finally {
      if (previous !== undefined) process.env.LICENCE_SIGNING_PRIVATE_KEY = previous;
    }
  });
});
