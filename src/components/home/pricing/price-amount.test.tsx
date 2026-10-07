import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PricesState } from '@/hooks/use-paddle-prices';
import { PriceAmount } from './price-amount';

const render = (prices: PricesState, basePrice: string | null = null) =>
  renderToStaticMarkup(
    <PriceAmount prices={prices} basePrice={basePrice} priceId={'pri_01month'} priceSuffix={'per month'} />,
  );

describe('PriceAmount', () => {
  it("shows the price's localised total, without a zero fraction, in place of the base price, and that it includes tax", () => {
    const html = render({ status: 'ready', prices: { pri_01month: '€30.00', pri_01year: '€300.00' } }, '£15');

    expect(html).toContain('€30<');
    expect(html).not.toContain('€300');
    expect(html).not.toContain('£15');
    expect(html).not.toContain('your currency');
    expect(html).toContain('per month. Includes any tax for your country.');
  });

  it('shows the base price, and that the checkout shows the visitor’s own, until Paddle.js does or if it cannot', () => {
    for (const prices of [{ status: 'loading' }, { status: 'failed' }] as PricesState[]) {
      const html = render(prices, '£15');

      expect(html).toContain('£15<');
      expect(html).toContain('per month. The checkout shows the price in your currency, with any tax.');
      expect(html).not.toContain('could not be loaded');
    }
  });

  it('says when no price could be loaded, instead of loading for ever', () => {
    expect(render({ status: 'failed' })).toContain('The price could not be loaded.');
    expect(render({ status: 'loading' })).not.toContain('could not be loaded');
  });
});
