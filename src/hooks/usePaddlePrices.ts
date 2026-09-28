import { Paddle, PricePreviewParams, PricePreviewResponse } from '@paddle/paddle-js';
import { useEffect, useState } from 'react';
import { ProOffer } from '@/constants/pro-offer';

export type PaddlePrices = Record<string, string>;

function getLineItems(): PricePreviewParams['items'] {
  return Object.values(ProOffer.priceId).map((priceId) => ({ priceId, quantity: 1 }));
}

function getPriceAmounts(prices: PricePreviewResponse) {
  return prices.data.details.lineItems.reduce((acc, item) => {
    acc[item.price.id] = item.formattedTotals.total;
    return acc;
  }, {} as PaddlePrices);
}

/**
 * The Pro offer's prices for the visitor. No address is passed, so Paddle localises them (currency and
 * tax) from the visitor's IP address, as the checkout does.
 */
export function usePaddlePrices(paddle: Paddle | undefined): { prices: PaddlePrices; loading: boolean } {
  const [prices, setPrices] = useState<PaddlePrices>({});
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    paddle?.PricePreview({ items: getLineItems() } as PricePreviewParams).then((prices) => {
      setPrices(getPriceAmounts(prices));
      setLoading(false);
    });
  }, [paddle]);
  return { prices, loading };
}
