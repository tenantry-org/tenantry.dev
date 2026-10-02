import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PricesState } from '@/hooks/use-paddle-prices';
import { PriceAmount } from './price-amount';

const render = (prices: PricesState) =>
  renderToStaticMarkup(<PriceAmount prices={prices} priceId={'pri_01month'} priceSuffix={'per month'} />);

describe('PriceAmount', () => {
  it("shows the price's localised total, without a zero fraction", () => {
    const html = render({ status: 'ready', prices: { pri_01month: '€30.00', pri_01year: '€300.00' } });

    expect(html).toContain('€30<');
    expect(html).not.toContain('€300');
  });

  it('says when the price could not be loaded, instead of loading for ever', () => {
    expect(render({ status: 'failed' })).toContain('The price could not be loaded.');
    expect(render({ status: 'loading' })).not.toContain('could not be loaded');
  });
});
