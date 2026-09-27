import { afterEach, describe, expect, it } from 'vitest';
import { provisioningAllowed } from './provisioning-guard';

const KEY = 'PROVISION_ALLOWLIST';

describe('provisioningAllowed', () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it('allows everyone when the allowlist is unset (production behaviour)', () => {
    expect(provisioningAllowed('anyone@example.com')).toBe(true);
    expect(provisioningAllowed(null)).toBe(true);
  });

  it('allows only listed emails (case-insensitive) when set', () => {
    process.env[KEY] = 'me@tenantry.dev, Tester@Example.com';

    expect(provisioningAllowed('me@tenantry.dev')).toBe(true);
    expect(provisioningAllowed('tester@example.com')).toBe(true);
    expect(provisioningAllowed('stranger@example.com')).toBe(false);
  });

  it('fails closed for an unknown email when the allowlist is active', () => {
    process.env[KEY] = 'me@tenantry.dev';

    expect(provisioningAllowed(null)).toBe(false);
    expect(provisioningAllowed(undefined)).toBe(false);
  });
});
