import type { PricesState } from '@/hooks/use-paddle-prices';
import { CHECKOUT_PRICE_NOTE } from '@/lib/pro-price';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  prices: PricesState;
  /** The price as Paddle holds it, shown until Paddle.js shows the visitor's own, or in its place; null if not read. */
  basePrice: string | null;
  priceId: string;
  priceSuffix: string;
}

/**
 * The visitor's price once Paddle.js has localised it, and until then, or if it cannot, the base price. The localised
 * price is the checkout's total for the visitor's country, tax included, so it says so.
 */
export function PriceAmount({ prices, basePrice, priceId, priceSuffix }: Props) {
  const localised = prices.status === 'ready';
  const amount = localised ? prices.prices[priceId] : basePrice;
  const unknown = !localised && !basePrice;

  return (
    <div className={'flex flex-col gap-1'}>
      {!unknown && (
        <div className={'text-5xl leading-[60px] font-bold tracking-tight'}>{amount?.replace(/\.00$/, '')}</div>
      )}
      {unknown && prices.status === 'loading' && <Skeleton className={'h-[60px] w-48'} />}
      {unknown && prices.status === 'failed' && (
        <div className={'flex h-[60px] items-center text-muted-foreground'}>The price could not be loaded.</div>
      )}
      <div className={'text-sm text-muted-foreground'}>
        {priceSuffix}
        {localised ? '. Includes any tax for your country.' : basePrice && `. ${CHECKOUT_PRICE_NOTE}`}
      </div>
    </div>
  );
}
