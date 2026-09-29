import { checkoutEnabled, ProOffer } from '@/constants/pro-offer';
import { IBillingFrequency } from '@/constants/billing-frequency';
import { FeaturesList } from '@/components/home/pricing/features-list';
import { PriceAmount } from '@/components/home/pricing/price-amount';
import { Button } from '@/components/ui/button';
import { PriceTitle } from '@/components/home/pricing/price-title';
import Link from 'next/link';

interface Props {
  loading: boolean;
  frequency: IBillingFrequency;
  priceMap: Record<string, string>;
}

export function PriceCards({ loading, frequency, priceMap }: Props) {
  const offer = ProOffer;

  return (
    <div className={'w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-sm'}>
      <div className={'flex flex-col gap-6 p-8'}>
        <PriceTitle offer={offer} />
        <PriceAmount
          loading={loading}
          offer={offer}
          priceMap={priceMap}
          value={frequency.value}
          priceSuffix={frequency.priceSuffix}
        />
        <p className={'text-muted-foreground'}>{offer.description}</p>
        {checkoutEnabled ? (
          <Button className={'w-full'} size={'lg'} asChild={true}>
            <Link href={`/checkout/${offer.priceId[frequency.value]}`}>Get started</Link>
          </Button>
        ) : (
          <Button className={'w-full'} size={'lg'} disabled={true}>
            Available soon
          </Button>
        )}
      </div>
      <div className={'border-t border-border bg-surface px-8 py-6'}>
        <FeaturesList offer={offer} />
      </div>
    </div>
  );
}
