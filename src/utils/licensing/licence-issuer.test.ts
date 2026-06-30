import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify as cryptoVerify } from 'crypto';
import { issueLicence } from './licence-issuer';

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

describe('issueLicence', () => {
  it('produces a DER-signed ES256 JWT that verifies against the matching public key', () => {
    const token = issueLicence(
      { customerId: 'ctm_123', tier: 'pro', seats: 5, expiresAt: new Date(Date.now() + 3_600_000) },
      privateKey,
    );

    const [header, payload, signature] = token.split('.');

    // Verify with dsaEncoding 'der' — the exact format Tenantry.Pro's validator expects.
    const ok = cryptoVerify(
      'sha256',
      Buffer.from(`${header}.${payload}`, 'ascii'),
      { key: publicKey, dsaEncoding: 'der' },
      base64UrlDecode(signature),
    );

    expect(ok).toBe(true);
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
