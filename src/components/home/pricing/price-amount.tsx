import { Offer } from '@/constants/pro-offer';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  loading: boolean;
  offer: Offer;
  priceMap: Record<string, string>;
  value: string;
  priceSuffix: string;
}

export function PriceAmount({ loading, offer, priceMap, priceSuffix, value }: Props) {
  return (
    <div className={'flex flex-col gap-1'}>
      {loading ? (
        <Skeleton className={'h-[60px] w-48'} />
      ) : (
        <div className={'text-5xl leading-[60px] font-bold tracking-tight'}>
          {priceMap[offer.priceId[value]]?.replace(/\.00$/, '')}
        </div>
      )}
      <div className={'text-sm text-muted-foreground'}>{priceSuffix}</div>
    </div>
  );
}
