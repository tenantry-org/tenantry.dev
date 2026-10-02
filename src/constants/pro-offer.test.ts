import { describe, expect, it } from 'vitest';
import { isOfferPrice } from './pro-offer';

describe('isOfferPrice', () => {
  const prices = { month: 'pri_01month', year: 'pri_01year' };

  it("accepts only the environment's two Pro prices", () => {
    expect(isOfferPrice('pri_01month', prices)).toBe(true);
    expect(isOfferPrice('pri_01year', prices)).toBe(true);
    expect(isOfferPrice('pri_01other', prices)).toBe(false);
    expect(isOfferPrice('', prices)).toBe(false);
  });
});
