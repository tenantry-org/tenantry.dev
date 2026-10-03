import { ProOffer } from '@/constants/pro-offer';
import type { BillingIntervalOption } from '@/constants/billing-intervals';
import type { PricesState } from '@/hooks/use-paddle-prices';
import { publicConfig } from '@/lib/public-config';
import { FeaturesList } from '@/components/home/pricing/features-list';
import { PriceAmount } from '@/components/home/pricing/price-amount';
import { Button } from '@/components/ui/button';
import { PriceTitle } from '@/components/home/pricing/price-title';
import { LogoMark } from '@/components/brand/logo';
import Link from 'next/link';

interface Props {
  option: BillingIntervalOption;
  prices: PricesState;
}

const CARD = 'flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm';

export function PriceCards({ option, prices }: Props) {
  const offer = ProOffer;
  // Read while the home page prerenders, so a build without the public configuration fails (public-config.ts).
  const { paddle, checkoutEnabled } = publicConfig();
  const priceId = paddle.prices[option.interval];

  return (
    <div className={'grid w-full max-w-4xl gap-6 md:grid-cols-[1fr_1.4fr]'}>
      <div className={`${CARD} md:self-start`}>
        <div className={'flex flex-col gap-6 p-8'}>
          <div className={'flex items-center gap-3'}>
            <LogoMark className={'h-8'} />
            <h3 className={'text-xl font-semibold'}>Tenantry Core</h3>
          </div>
          <div className={'flex flex-col gap-1'}>
            <div className={'text-5xl leading-[60px] font-bold tracking-tight'}>Free</div>
            <div className={'text-sm text-muted-foreground'}>Apache-2.0, on GitHub</div>
          </div>
          <p className={'text-muted-foreground'}>
            Tenant resolution and EF Core isolation, in a shared database or a database per tenant.
          </p>
          <Button className={'w-full'} size={'lg'} variant={'outline'} asChild={true}>
            <Link href={'/docs/core/getting-started'}>Get started with Core</Link>
          </Button>
        </div>
      </div>

      <div className={CARD}>
        <div className={'flex flex-col gap-6 p-8'}>
          <PriceTitle offer={offer} />
          <PriceAmount prices={prices} priceId={priceId} priceSuffix={option.priceSuffix} />
          <p className={'text-muted-foreground'}>{offer.description}</p>
          {checkoutEnabled ? (
            <Button className={'w-full'} size={'lg'} asChild={true}>
              <Link href={`/checkout/${priceId}`}>Subscribe to Pro</Link>
            </Button>
          ) : (
            <Button className={'w-full'} size={'lg'} disabled={true}>
              Available soon
            </Button>
          )}
          <p className={'-mt-3 text-center text-xs text-muted-foreground'}>
            <Link href={'/legal/refunds'} className={'hover:underline'}>
              14-day refund
            </Link>{' '}
            · Cancel any time · The versions you have keep working
          </p>
        </div>
        <div className={'border-t border-border bg-surface px-8 py-6'}>
          <FeaturesList offer={offer} />
        </div>
      </div>
    </div>
  );
}
