import type { PricesState } from '@/hooks/use-paddle-prices';

interface Props {
  prices: PricesState;
  priceId: string;
  /** The list price, shown until Paddle's localised price is ready, and in its place if it never is. */
  listPrice: string;
  priceSuffix: string;
}

export function PriceAmount({ prices, priceId, listPrice, priceSuffix }: Props) {
  const amount = (prices.status === 'ready' && prices.prices[priceId]?.replace(/\.00$/, '')) || listPrice;

  return (
    <div className={'flex flex-col gap-1'}>
      <div className={'text-5xl leading-[60px] font-bold tracking-tight'}>{amount}</div>
      <div className={'text-sm text-muted-foreground'}>{priceSuffix}, excl. tax</div>
    </div>
  );
}
