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
    </div>
  );
}
