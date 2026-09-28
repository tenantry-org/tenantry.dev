import { Offer } from '@/constants/pro-offer';
import { CircleCheck } from 'lucide-react';

interface Props {
  offer: Offer;
}

export function FeaturesList({ offer }: Props) {
  return (
    <ul className={'p-8 flex flex-col gap-4'}>
      {offer.features.map((feature: string) => (
        <li key={feature} className="flex gap-x-3">
          <CircleCheck className={'h-6 w-6 text-muted-foreground'} />
          <span className={'text-base'}>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
