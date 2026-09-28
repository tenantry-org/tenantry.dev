import { afterEach, describe, expect, it } from 'vitest';
import { parseTierMap, resolveTier } from './tier-mapping';

const ENV_KEY = 'PADDLE_PRODUCT_TIER_MAP';

describe('resolveTier', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('resolves a product id from the env-configured map', () => {
    process.env[ENV_KEY] = JSON.stringify({ pro_real_id: 'pro', advanced_real_id: 'advanced' });

    expect(resolveTier('pro_real_id')).toBe('pro');
    expect(resolveTier('advanced_real_id')).toBe('advanced');
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

  it('fails rather than falling back when the map is missing or invalid', () => {
    expect(() => resolveTier('pro_real_id')).toThrow(/not set/);

    process.env[ENV_KEY] = '{not valid json';
    expect(() => resolveTier('pro_real_id')).toThrow(/not valid JSON/);
  });
});

describe('parseTierMap', () => {
  it.each([
    ['an array', '["pro"]'],
    ['an empty object', '{}'],
    ['a tier that does not exist', '{"prod_1": "enterprise"}'],
    ['a non-string tier', '{"prod_1": 1}'],
    ['an empty product id', '{" ": "pro"}'],
  ])('rejects %s', (_, raw) => {
    expect(() => parseTierMap(raw)).toThrow(/PADDLE_PRODUCT_TIER_MAP/);
  });
});
