import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PricesState } from '@/hooks/use-paddle-prices';
import { PriceAmount } from './price-amount';

const render = (prices: PricesState) =>
  renderToStaticMarkup(
    <PriceAmount prices={prices} priceId={'pri_01month'} listPrice={'€29'} priceSuffix={'per month'} />,
  );

describe('PriceAmount', () => {
  it("shows the price's localised amount, without a zero fraction", () => {
    const html = render({ status: 'ready', prices: { pri_01month: '$32.00', pri_01year: '$320.00' } });

    expect(html).toContain('$32<');
    expect(html).not.toContain('$320');
    expect(html).not.toContain('€29');
  });

  it('shows the list price until Paddle answers, and if it never does', () => {
    expect(render({ status: 'loading' })).toContain('€29<');
    expect(render({ status: 'failed' })).toContain('€29<');
  });

  it('says the price excludes tax', () => {
    expect(render({ status: 'loading' })).toContain('per month, excl. tax');
  });
});
