import { Offer } from '@/constants/pro-offer';
import { LogoMark } from '@/components/brand/logo';

interface Props {
  offer: Offer;
}

export function PriceTitle({ offer }: Props) {
  return (
    <div className={'flex items-center gap-3'}>
      <LogoMark className={'h-8'} />
      <h3 className={'text-xl font-semibold'}>{offer.name}</h3>
      <span className={'rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground'}>
        Beta
      </span>
    </div>
  );
}
