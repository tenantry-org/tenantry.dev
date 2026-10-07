import { ProOffer } from '@/constants/pro-offer';
import type { BillingIntervalOption } from '@/constants/billing-intervals';
import type { PricesState } from '@/hooks/use-paddle-prices';
import { publicConfig } from '@/lib/public-config';
import { PriceAmount } from '@/components/home/pricing/price-amount';
import { Button } from '@/components/ui/button';
import { PriceTitle } from '@/components/home/pricing/price-title';
import { LogoMark } from '@/components/brand/logo';
import Link from 'next/link';

interface Props {
  option: BillingIntervalOption;
  prices: PricesState;
  /** This interval's base price, shown until the visitor's own is, or null. */
  basePrice: string | null;
  proLink: boolean;
}

// The Pro page's answer to what a subscriber keeps when the subscription ends.
const SUBSCRIPTION_ENDS = '/pro#subscription-ends';

const CARD = 'flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm';

export function PriceCards({ option, prices, basePrice, proLink }: Props) {
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
            <div className={'text-sm text-muted-foreground'}>Apache-2.0: free for commercial use</div>
          </div>
          <Button className={'w-full'} size={'lg'} variant={'outline'} asChild={true}>
            <Link href={'/docs/core/getting-started'}>Get started with Core</Link>
          </Button>
        </div>
      </div>

      <div className={CARD}>
        <div className={'flex flex-col gap-6 p-8'}>
          <PriceTitle offer={offer} />
          <PriceAmount prices={prices} basePrice={basePrice} priceId={priceId} priceSuffix={option.priceSuffix} />
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
            · Cancel any time ·{' '}
            <Link href={SUBSCRIPTION_ENDS} className={'hover:underline'}>
              Keep vested releases after 12 paid months or a paid year
            </Link>
          </p>
        </div>
        {proLink && (
          <div className={'border-t border-border bg-surface px-8 py-6 text-sm'}>
            <Link href={'/pro'} className={'font-medium text-link hover:underline'}>
              What Pro includes
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
