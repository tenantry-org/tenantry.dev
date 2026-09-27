import { afterEach, describe, expect, it } from 'vitest';
import { automatedProvisioningEnabled, provisioningAllowed } from './provisioning-guard';

describe('automatedProvisioningEnabled', () => {
  afterEach(() => {
    delete process.env.PROVISIONING_MODE;
  });

  it('is off when PROVISIONING_MODE is unset', () => {
    expect(automatedProvisioningEnabled()).toBe(false);
  });

  it('is on only for "auto" (trimmed, case-insensitive)', () => {
    process.env.PROVISIONING_MODE = ' Auto ';
    expect(automatedProvisioningEnabled()).toBe(true);

    for (const value of ['manual', 'true', 'automatic', '']) {
      process.env.PROVISIONING_MODE = value;
      expect(automatedProvisioningEnabled()).toBe(false);
    }
  });
});

describe('provisioningAllowed', () => {
  afterEach(() => {
    delete process.env.PROVISIONING_MODE;
    delete process.env.PROVISION_ALLOWLIST;
  });

  it('refuses everyone in manual mode, even allowlisted customers', () => {
    process.env.PROVISION_ALLOWLIST = 'me@tenantry.dev';

    expect(provisioningAllowed('me@tenantry.dev')).toBe(false);
    expect(provisioningAllowed('anyone@example.com')).toBe(false);
  });

  it('allows everyone in automated mode without an allowlist', () => {
    process.env.PROVISIONING_MODE = 'auto';

    expect(provisioningAllowed('anyone@example.com')).toBe(true);
    expect(provisioningAllowed(null)).toBe(true);
  });

  it('allows only listed emails (case-insensitive) in automated mode with an allowlist', () => {
    process.env.PROVISIONING_MODE = 'auto';
    process.env.PROVISION_ALLOWLIST = 'me@tenantry.dev, Tester@Example.com';

    expect(provisioningAllowed('me@tenantry.dev')).toBe(true);
    expect(provisioningAllowed('tester@example.com')).toBe(true);
    expect(provisioningAllowed('stranger@example.com')).toBe(false);
  });

  it('fails closed for an unknown email when the allowlist is active', () => {
    process.env.PROVISIONING_MODE = 'auto';
    process.env.PROVISION_ALLOWLIST = 'me@tenantry.dev';

    expect(provisioningAllowed(null)).toBe(false);
    expect(provisioningAllowed(undefined)).toBe(false);
  });
});
