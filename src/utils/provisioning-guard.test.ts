import { afterEach, describe, expect, it } from 'vitest';
import { automatedProvisioningEnabled } from './provisioning-guard';

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
