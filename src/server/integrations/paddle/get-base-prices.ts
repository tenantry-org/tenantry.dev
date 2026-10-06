import 'server-only';
import { cacheLife, io } from 'next/cache';
import type { Price } from '@paddle/paddle-node-sdk';
import { type BasePrices, formatBasePrice } from '@/lib/pro-price';
import { serverConfig } from '@/server/config/server-config';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';

/** Pro's monthly and yearly prices as Paddle holds them: each price's unit price, in its base currency. */
export async function getBasePrices(
  priceIds = serverConfig().paddle.prices,
  paddle = getPaddleInstance(),
): Promise<BasePrices> {
  const [month, year] = await Promise.all([priceIds.month, priceIds.year].map((id) => paddle.prices.get(id)));
  return { month: unitPrice(month), year: unitPrice(year) };
}

/**
 * Pro's base prices, read from Paddle at most once an hour, or null, logged, when Paddle cannot be read. Never throws.
 * It reads them only when a page is requested, so a page that shows them prerenders without them and streams them in.
 */
export async function basePricesOrNull(): Promise<BasePrices | null> {
  await io(); // the build has no server configuration, so it cannot read Paddle
  try {
    return await cachedBasePrices();
  } catch (error) {
    console.error('Paddle: the base prices could not be read:', error);
    return null;
  }
}

// A failure throws out of the cache, so it is not kept: the next request asks Paddle again.
async function cachedBasePrices(): Promise<BasePrices> {
  'use cache';
  cacheLife('hours');
  return getBasePrices();
}

function unitPrice(price: Price): string {
  return formatBasePrice(price.unitPrice.amount, price.unitPrice.currencyCode);
}
