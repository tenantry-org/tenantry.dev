import type { PricesState } from '@/hooks/use-paddle-prices';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  prices: PricesState;
  priceId: string;
  priceSuffix: string;
}

export function PriceAmount({ prices, priceId, priceSuffix }: Props) {
  return (
    <div className={'flex flex-col gap-1'}>
      {prices.status === 'loading' && <Skeleton className={'h-[60px] w-48'} />}
      {prices.status === 'ready' && (
        <div className={'text-5xl leading-[60px] font-bold tracking-tight'}>
          {prices.prices[priceId]?.replace(/\.00$/, '')}
        </div>
      )}
      {prices.status === 'failed' && (
        <div className={'flex h-[60px] items-center text-muted-foreground'}>The price could not be loaded.</div>
      )}
      <div className={'text-sm text-muted-foreground'}>{priceSuffix}</div>
    </div>
  );
}
