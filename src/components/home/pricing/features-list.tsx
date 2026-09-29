import { Offer } from '@/constants/pro-offer';
import { Check } from 'lucide-react';

interface Props {
  offer: Offer;
}

export function FeaturesList({ offer }: Props) {
  return (
    <ul className={'flex flex-col gap-3 text-sm'}>
      {offer.features.map((feature: string) => (
        <li key={feature} className={'flex gap-3'}>
          <Check className={'mt-0.5 h-4 w-4 shrink-0 text-link'} aria-hidden={true} />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
