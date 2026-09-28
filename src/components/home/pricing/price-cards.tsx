import { checkoutEnabled, ProOffer } from '@/constants/pro-offer';
import { IBillingFrequency } from '@/constants/billing-frequency';
import { FeaturesList } from '@/components/home/pricing/features-list';
import { PriceAmount } from '@/components/home/pricing/price-amount';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PriceTitle } from '@/components/home/pricing/price-title';
import { Separator } from '@/components/ui/separator';
import { FeaturedCardGradient } from '@/components/gradients/featured-card-gradient';
import Link from 'next/link';

interface Props {
  loading: boolean;
  frequency: IBillingFrequency;
  priceMap: Record<string, string>;
}

export function PriceCards({ loading, frequency, priceMap }: Props) {
  const offer = ProOffer;

  return (
    <div className="isolate mx-auto grid max-w-lg grid-cols-1 gap-8">
      <div className={cn('rounded-lg bg-background/70 backdrop-blur-[6px] overflow-hidden')}>
        <div className={cn('flex gap-5 flex-col rounded-lg rounded-b-none pricing-card-border')}>
          <FeaturedCardGradient />
          <PriceTitle offer={offer} />
          <PriceAmount
            loading={loading}
            offer={offer}
            priceMap={priceMap}
            value={frequency.value}
            priceSuffix={frequency.priceSuffix}
          />
          <div className={'px-8'}>
            <Separator className={'bg-border'} />
          </div>
          <div className={'px-8 text-[16px] leading-[24px]'}>{offer.description}</div>
        </div>
        <div className={'px-8 mt-8'}>
          {checkoutEnabled ? (
            <Button className={'w-full'} variant={'secondary'} asChild={true}>
              <Link href={`/checkout/${offer.priceId[frequency.value]}`}>Get started</Link>
            </Button>
          ) : (
            <Button className={'w-full'} variant={'secondary'} disabled={true}>
              Available soon
            </Button>
          )}
        </div>
        <FeaturesList offer={offer} />
      </div>
    </div>
  );
}
