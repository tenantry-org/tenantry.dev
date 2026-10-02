import type { Paddle, PricePreviewResponse } from '@paddle/paddle-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPaddle } from './use-paddle';
import { previewPrices } from './use-paddle-prices';

// The public configuration is compiled from these variables (public-config.ts); this file reads it once.
beforeAll(() => {
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_PADDLE_ENV: 'sandbox',
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test_client_token',
    NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: 'pri_01month',
    NEXT_PUBLIC_PADDLE_PRICE_YEARLY: 'pri_01year',
  })) {
    vi.stubEnv(name, value);
  }
  return () => vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks(); // the console spies
});

const paddle = (pricePreview: Paddle['PricePreview'], initialized = true) =>
  ({ PricePreview: pricePreview, Initialized: initialized }) as unknown as Paddle;

describe('loadPaddle', () => {
  it("initialises Paddle.js with this environment's client token and the page's settings", async () => {
    const instance = paddle(vi.fn());
    const initialize = vi.fn(async () => instance);
    const eventCallback = vi.fn();

    await expect(loadPaddle(() => ({ eventCallback }), initialize)).resolves.toEqual({
      status: 'ready',
      paddle: instance,
    });
    expect(initialize).toHaveBeenCalledWith({ eventCallback, token: 'test_client_token', environment: 'sandbox' });
  });

  it('fails, without throwing, when Paddle.js does not load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      loadPaddle(
        () => ({}),
        vi.fn(async () => undefined),
      ),
    ).resolves.toEqual({ status: 'failed' });
    // Paddle.js catches a setup that throws, logs it, and returns the instance uninitialised.
    await expect(
      loadPaddle(
        () => ({}),
        vi.fn(async () => paddle(vi.fn(), false)),
      ),
    ).resolves.toEqual({
      status: 'failed',
    });
    await expect(
      loadPaddle(
        () => ({}),
        vi.fn(async () => {
          throw new Error('script blocked');
        }),
      ),
    ).resolves.toEqual({ status: 'failed' });
    expect(log).toHaveBeenCalledTimes(3);
  });
});

describe('previewPrices', () => {
  const preview = {
    data: {
      details: {
        lineItems: [
          { price: { id: 'pri_01month' }, formattedTotals: { total: '€30.00' } },
          { price: { id: 'pri_01year' }, formattedTotals: { total: '€300.00' } },
        ],
      },
    },
  } as unknown as PricePreviewResponse;

  it("previews the Pro offer's two prices, by price id", async () => {
    const pricePreview = vi.fn(async () => preview);

    await expect(previewPrices(paddle(pricePreview))).resolves.toEqual({
      status: 'ready',
      prices: { pri_01month: '€30.00', pri_01year: '€300.00' },
    });
    expect(pricePreview).toHaveBeenCalledWith({
      items: [
        { priceId: 'pri_01month', quantity: 1 },
        { priceId: 'pri_01year', quantity: 1 },
      ],
    });
  });

  it('fails, without throwing, when the preview fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      previewPrices(
        paddle(
          vi.fn(async () => {
            throw new Error('network');
          }),
        ),
      ),
    ).resolves.toEqual({ status: 'failed' });
  });
});
