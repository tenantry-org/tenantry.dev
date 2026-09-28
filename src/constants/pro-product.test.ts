import { afterEach, describe, expect, it } from 'vitest';
import { isProProduct, parseProProductId } from './pro-product';

const ENV_KEY = 'PADDLE_PRO_PRODUCT_ID';

describe('isProProduct', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('recognises the configured Pro product and nothing else', () => {
    process.env[ENV_KEY] = 'pro_01hsxyh9txq4rzbrhbyngkhy46';

    expect(isProProduct('pro_01hsxyh9txq4rzbrhbyngkhy46')).toBe(true);
    expect(isProProduct('pro_01other')).toBe(false);
    expect(isProProduct(null)).toBe(false);
    expect(isProProduct(undefined)).toBe(false);
    expect(isProProduct('')).toBe(false);
  });

  it('fails rather than recognising nothing when the product id is missing', () => {
    expect(() => isProProduct('pro_01hsxyh9txq4rzbrhbyngkhy46')).toThrow(/not set/);
  });
});

describe('parseProProductId', () => {
  it('accepts a Paddle product id, ignoring surrounding space', () => {
    expect(parseProProductId(' pro_01hsxyh9txq4rzbrhbyngkhy46 ')).toBe('pro_01hsxyh9txq4rzbrhbyngkhy46');
  });

  it.each([
    ['nothing', undefined],
    ['an empty value', '  '],
    ['a price id', 'pri_01hsxycme6m95sejkz7sbz5e9g'],
    ['the old tier map', '{"pro_01": "pro"}'],
  ])('rejects %s', (_, raw) => {
    expect(() => parseProProductId(raw)).toThrow(/PADDLE_PRO_PRODUCT_ID/);
  });
});
