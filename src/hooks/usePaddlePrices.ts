import type { Paddle, PricePreviewResponse } from '@paddle/paddle-js';
import { useEffect, useState } from 'react';
import type { PaddleState } from '@/hooks/usePaddle';
import { publicConfig } from '@/lib/public-config';

/** Each Pro price's total, formatted for the visitor, by Paddle price id. */
export type PaddlePrices = Record<string, string>;

export type PricesState = { status: 'loading' } | { status: 'ready'; prices: PaddlePrices } | { status: 'failed' };

/** The Pro offer's prices for the visitor, once Paddle.js is ready; 'failed' when it or the preview fails. */
export function usePaddlePrices(paddle: PaddleState): PricesState {
  const [preview, setPreview] = useState<PricesState>({ status: 'loading' });

  useEffect(() => {
    if (paddle.status !== 'ready') return;
    let mounted = true;

    void previewPrices(paddle.paddle).then((previewed) => {
      if (mounted) setPreview(previewed);
    });

    return () => {
      mounted = false;
    };
  }, [paddle]);

  return paddle.status === 'failed' ? paddle : preview;
}

/**
 * Previews the Pro offer's prices. No address is passed, so Paddle localises them (currency and tax) from the
 * visitor's IP address, as the checkout does. 'failed', logged, when the preview fails. Never throws.
 */
export async function previewPrices(paddle: Paddle): Promise<PricesState> {
  try {
    const { month, year } = publicConfig().paddle.prices;
    const preview = await paddle.PricePreview({ items: [month, year].map((priceId) => ({ priceId, quantity: 1 })) });
    return { status: 'ready', prices: priceAmounts(preview) };
  } catch (error) {
    console.error('Paddle price preview failed:', error);
    return { status: 'failed' };
  }
}

function priceAmounts(preview: PricePreviewResponse): PaddlePrices {
  return Object.fromEntries(preview.data.details.lineItems.map((item) => [item.price.id, item.formattedTotals.total]));
}
