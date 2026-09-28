import { Offer } from '@/constants/pro-offer';
import Image from 'next/image';

interface Props {
  offer: Offer;
}

export function PriceTitle({ offer }: Props) {
  const { name, icon } = offer;
  return (
    <div className={'flex justify-between items-center px-8 pt-8 featured-price-title'}>
      <div className={'flex items-center gap-[10px]'}>
        <Image src={icon} height={40} width={40} alt={name} />
        <p className={'text-[20px] leading-[30px] font-semibold'}>{name}</p>
      </div>
    </div>
  );
}
