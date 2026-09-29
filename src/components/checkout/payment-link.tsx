'use client';

import { type Environments, initializePaddle } from '@paddle/paddle-js';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useTheme } from 'fumadocs-ui/provider/base';

/**
 * Opens the checkout for a transaction Paddle created (`?_ptxn=txn_…`): the invoice, renewal and
 * payment-method links Paddle sends customers. Paddle.js opens that transaction's checkout by itself once
 * initialised, so this only initialises it. It cannot start a new purchase, so it is not behind
 * NEXT_PUBLIC_CHECKOUT_ENABLED.
 */
export function PaymentLink() {
  const transactionId = useSearchParams().get('_ptxn');
  // Paddle's overlay takes its theme when it opens, so it matches the site's theme at that moment.
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!transactionId || !token || !resolvedTheme || !process.env.NEXT_PUBLIC_PADDLE_ENV) return;

    initializePaddle({
      token,
      environment: process.env.NEXT_PUBLIC_PADDLE_ENV as Environments,
      checkout: {
        settings: {
          displayMode: 'overlay',
          theme: resolvedTheme === 'dark' ? 'dark' : 'light',
          successUrl: `${window.location.origin}/checkout/success`,
        },
      },
    });
  }, [transactionId, resolvedTheme]);

  return (
    <p className={'max-w-md text-center text-lg text-muted-foreground'}>
      {transactionId
        ? 'Opening the secure Paddle checkout…'
        : 'This page opens payment links from Tenantry. The link you followed has no payment to open.'}
    </p>
  );
}
