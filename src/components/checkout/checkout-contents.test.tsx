import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaddleSettings, PaddleState } from '@/hooks/use-paddle';
import { CheckoutContents } from './checkout-contents';

const usePaddle = vi.hoisted(() => vi.fn<(settings: () => PaddleSettings) => PaddleState>());
vi.mock('@/hooks/use-paddle', () => ({ usePaddle }));

describe('CheckoutContents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the inline checkout without the field for adding a discount code: no discount is offered', () => {
    usePaddle.mockReturnValue({ status: 'loading' });
    vi.stubGlobal('window', { location: { origin: 'https://example.com' } });

    renderToStaticMarkup(<CheckoutContents priceId={'pri_01month'} userEmail={'buyer@example.com'} />);
    const settings = usePaddle.mock.calls[0][0]().checkout?.settings;

    expect(settings).toMatchObject({
      displayMode: 'inline',
      showAddDiscounts: false,
      successUrl: 'https://example.com/checkout/success',
    });
  });
});
