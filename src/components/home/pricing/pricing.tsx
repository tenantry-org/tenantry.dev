'use client';

import { Toggle } from '@/components/shared/toggle/toggle';
import { PriceCards } from '@/components/home/pricing/price-cards';
import { useEffect, useState } from 'react';
import { BillingFrequency, IBillingFrequency } from '@/constants/billing-frequency';
import { Environments, initializePaddle, Paddle } from '@paddle/paddle-js';
import { usePaddlePrices } from '@/hooks/usePaddlePrices';

export function Pricing() {
  const [frequency, setFrequency] = useState<IBillingFrequency>(BillingFrequency[0]);
  const [paddle, setPaddle] = useState<Paddle | undefined>(undefined);

  const { prices, loading } = usePaddlePrices(paddle);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN && process.env.NEXT_PUBLIC_PADDLE_ENV) {
      initializePaddle({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
        environment: process.env.NEXT_PUBLIC_PADDLE_ENV as Environments,
      }).then((paddle) => {
        if (paddle) {
          setPaddle(paddle);
        }
      });
    }
  }, []);

  return (
    <section id="pricing" className={'scroll-mt-16 border-t border-border/70 bg-surface'}>
      <div className={'mx-auto flex max-w-6xl flex-col items-center px-4 py-20 md:px-8 md:py-24'}>
        <h2 className={'text-3xl font-bold tracking-tight md:text-4xl'}>Pricing</h2>
        <p className={'mt-4 mb-10 max-w-xl text-center text-lg text-muted-foreground'}>
          One Pro subscription, billed monthly or yearly. Tenantry Core stays free and open source.
        </p>
        <Toggle frequency={frequency} setFrequency={setFrequency} />
        <PriceCards frequency={frequency} loading={loading} priceMap={prices} />
      </div>
    </section>
  );
}
