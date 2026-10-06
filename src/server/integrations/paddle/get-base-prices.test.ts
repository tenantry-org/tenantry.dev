import { describe, expect, it, vi } from 'vitest';
import { getBasePrices } from './get-base-prices';

describe('getBasePrices', () => {
  it("formats the unit price of each configured price, in the price's own currency", async () => {
    const unitPrices: Record<string, { amount: string; currencyCode: string }> = {
      pri_month: { amount: '1500', currencyCode: 'GBP' },
      pri_year: { amount: '15000', currencyCode: 'GBP' },
    };
    const get = vi.fn(async (id: string) => ({ unitPrice: unitPrices[id] }));
    const paddle = { prices: { get } } as unknown as Parameters<typeof getBasePrices>[1];

    const prices = await getBasePrices({ month: 'pri_month', year: 'pri_year' }, paddle);

    expect(prices).toEqual({ month: '£15', year: '£150' });
    expect(get.mock.calls.map(([id]) => id)).toEqual(['pri_month', 'pri_year']);
  });
});
