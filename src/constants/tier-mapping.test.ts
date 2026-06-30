import { afterEach, describe, expect, it } from 'vitest';
import { resolveTier } from './tier-mapping';

const ENV_KEY = 'PADDLE_PRODUCT_TIER_MAP';

describe('resolveTier', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('resolves a product id from the env-configured map', () => {
    process.env[ENV_KEY] = JSON.stringify({ pro_real_id: 'pro', ent_real_id: 'enterprise' });

    expect(resolveTier('pro_real_id')).toBe('pro');
    expect(resolveTier('ent_real_id')).toBe('enterprise');
  });

  it('returns null for an unmapped product id', () => {
    process.env[ENV_KEY] = JSON.stringify({ pro_real_id: 'pro' });

    expect(resolveTier('unknown_product')).toBeNull();
  });

  it('returns null for null/undefined/empty input', () => {
    expect(resolveTier(null)).toBeNull();
    expect(resolveTier(undefined)).toBeNull();
    expect(resolveTier('')).toBeNull();
  });

  it('falls back to defaults when the env map is invalid JSON', () => {
    process.env[ENV_KEY] = '{not valid json';

    // Should not throw; unknown id under defaults resolves to null.
    expect(resolveTier('whatever')).toBeNull();
  });
});
