'use client';

import { PriceSection } from '@/components/checkout/price-section';
import { type Environments, initializePaddle, type Paddle } from '@paddle/paddle-js';
import type { CheckoutEventsData } from '@paddle/paddle-js/types/checkout/events';
import { useEffect, useState } from 'react';
import { track } from '@vercel/analytics';

interface Props {
  priceId: string;
  userEmail?: string;
}

export function CheckoutContents({ priceId, userEmail }: Props) {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [checkoutData, setCheckoutData] = useState<CheckoutEventsData | null>(null);

  const handleCheckoutEvents = (event: CheckoutEventsData) => {
    setCheckoutData(event);
  };

  useEffect(() => {
    if (!paddle?.Initialized && process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN && process.env.NEXT_PUBLIC_PADDLE_ENV) {
      initializePaddle({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
        environment: process.env.NEXT_PUBLIC_PADDLE_ENV as Environments,
        eventCallback: (event) => {
          if (event.data && event.name) {
            handleCheckoutEvents(event.data);
          }
          // The purchase funnel in Vercel Analytics: which plan was opened, and which were paid for.
          if (event.name === 'checkout.loaded') track('Checkout opened', { priceId });
          if (event.name === 'checkout.completed') track('Checkout completed', { priceId });
        },
        checkout: {
          settings: {
            variant: 'one-page',
            displayMode: 'inline',
            theme: 'dark',
            allowLogout: !userEmail,
            frameTarget: 'paddle-checkout-frame',
            frameInitialHeight: 450,
            frameStyle: 'width: 100%; background-color: transparent; border: none',
            // Paddle needs an absolute URL; a relative one is rejected and the buyer is not redirected.
            successUrl: `${window.location.origin}/checkout/success`,
          },
        },
      }).then((paddle) => {
        if (paddle && priceId) {
          setPaddle(paddle);
          // One subscription per purchase: the offer has no seats, so there is no quantity to choose.
          paddle.Checkout.open({
            ...(userEmail && { customer: { email: userEmail } }),
            items: [{ priceId: priceId, quantity: 1 }],
          });
        }
      });
    }
  }, [paddle?.Initialized, priceId, userEmail]);

  return (
    <div className={'rounded-xl border border-border bg-card p-6 shadow-sm md:p-10'}>
      <div className={'flex flex-col gap-10 md:flex-row md:gap-16'}>
        <div className={'w-full md:w-[360px] md:shrink-0'}>
          <PriceSection checkoutData={checkoutData} />
        </div>
        <div className={'min-w-0 flex-1'}>
          <h2 className={'mb-6 text-base font-semibold'}>Payment details</h2>
          <div className={'paddle-checkout-frame'} />
        </div>
      </div>
    </div>
  );
}
