'use client';

import { Toggle } from '@/components/shared/toggle/toggle';
import { PriceCards } from '@/components/home/pricing/price-cards';
import { useState } from 'react';
import { BILLING_INTERVALS, type BillingIntervalOption } from '@/constants/billing-intervals';
import { usePaddle } from '@/hooks/use-paddle';
import { usePaddlePrices } from '@/hooks/use-paddle-prices';
import type { BasePrices } from '@/lib/pro-price';

interface Props {
  /** Pro's prices as Paddle holds them, shown until Paddle.js shows the visitor's own, or null when not read. */
  basePrices: BasePrices | null;
  proLink: boolean;
}

/** The pricing block in the browser: the billing toggle, and the cards with the visitor's prices. */
export function PricingSection({ basePrices, proLink }: Readonly<Props>) {
  const [option, setOption] = useState<BillingIntervalOption>(BILLING_INTERVALS[0]);
  const prices = usePaddlePrices(usePaddle());

  return (
    <section id="pricing" className={'scroll-mt-16 border-t border-border/70 bg-surface'}>
      <div className={'mx-auto flex max-w-6xl flex-col items-center px-4 py-20 md:px-8 md:py-24'}>
        <h2 className={'text-3xl font-bold tracking-tight md:text-4xl'}>Pricing</h2>
        <p className={'mt-4 mb-10 max-w-xl text-center text-lg text-muted-foreground'}>
          Core is free. Pro is one subscription for your whole company, billed monthly or yearly.
        </p>
        <Toggle option={option} setOption={setOption} />
        <PriceCards
          option={option}
          prices={prices}
          basePrice={basePrices?.[option.interval] ?? null}
          proLink={proLink}
        />
      </div>
    </section>
  );
}
