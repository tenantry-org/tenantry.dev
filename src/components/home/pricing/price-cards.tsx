import { ProOffer } from '@/constants/pro-offer';
import { IBillingFrequency } from '@/constants/billing-frequency';
import type { PricesState } from '@/hooks/usePaddlePrices';
import { publicConfig } from '@/lib/public-config';
import { FeaturesList } from '@/components/home/pricing/features-list';
import { PriceAmount } from '@/components/home/pricing/price-amount';
import { Button } from '@/components/ui/button';
import { PriceTitle } from '@/components/home/pricing/price-title';
import Link from 'next/link';

interface Props {
  frequency: IBillingFrequency;
  prices: PricesState;
}

export function PriceCards({ frequency, prices }: Props) {
  const offer = ProOffer;
  // Read while the home page prerenders, so a build without the public configuration fails (public-config.ts).
  const { paddle, checkoutEnabled } = publicConfig();
  const priceId = paddle.prices[frequency.value];

  return (
    <div className={'w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-sm'}>
      <div className={'flex flex-col gap-6 p-8'}>
        <PriceTitle offer={offer} />
        <PriceAmount prices={prices} priceId={priceId} priceSuffix={frequency.priceSuffix} />
        <p className={'text-muted-foreground'}>{offer.description}</p>
        {checkoutEnabled ? (
          <Button className={'w-full'} size={'lg'} asChild={true}>
            <Link href={`/checkout/${priceId}`}>Get started</Link>
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
