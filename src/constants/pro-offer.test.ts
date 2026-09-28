import { afterEach, describe, expect, it, vi } from 'vitest';

describe('isOfferPrice', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(monthly?: string, yearly?: string) {
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_MONTHLY', monthly);
    vi.stubEnv('NEXT_PUBLIC_PADDLE_PRICE_YEARLY', yearly);
    return import('./pro-offer');
  }

  it("accepts only the environment's two Pro prices", async () => {
    const { isOfferPrice, ProOffer } = await load('pri_01month', 'pri_01year');

    expect(ProOffer.priceId).toEqual({ month: 'pri_01month', year: 'pri_01year' });
    expect(isOfferPrice('pri_01month')).toBe(true);
    expect(isOfferPrice('pri_01year')).toBe(true);
    expect(isOfferPrice('pri_01other')).toBe(false);
  });

  it('accepts nothing when the prices are not configured', async () => {
    const { isOfferPrice } = await load(undefined, undefined);

    expect(isOfferPrice('')).toBe(false);
    expect(isOfferPrice('pri_01month')).toBe(false);
  });

  it('keeps the checkout closed unless it is explicitly enabled', async () => {
    for (const [value, open] of [
      [undefined, false],
      ['false', false],
      ['1', false],
      ['true', true],
    ] as const) {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_CHECKOUT_ENABLED', value);
      expect((await import('./pro-offer')).checkoutEnabled).toBe(open);
    }
  });
});
