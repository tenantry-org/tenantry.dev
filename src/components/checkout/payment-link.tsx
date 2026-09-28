'use client';

import { type Environments, initializePaddle } from '@paddle/paddle-js';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Opens the checkout for a transaction Paddle created (`?_ptxn=txn_…`): the invoice, renewal and
 * payment-method links Paddle sends customers. Paddle.js opens that transaction's checkout by itself once
 * initialised, so this only initialises it. It cannot start a new purchase, so it is not behind
 * NEXT_PUBLIC_CHECKOUT_ENABLED.
 */
export function PaymentLink() {
  const transactionId = useSearchParams().get('_ptxn');

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!transactionId || !token || !process.env.NEXT_PUBLIC_PADDLE_ENV) return;

    initializePaddle({
      token,
      environment: process.env.NEXT_PUBLIC_PADDLE_ENV as Environments,
      checkout: {
        settings: { displayMode: 'overlay', theme: 'dark', successUrl: `${window.location.origin}/checkout/success` },
      },
    });
  }, [transactionId]);

  return (
    <p className={'text-lg text-center'}>
      {transactionId
        ? 'Opening the secure Paddle checkout…'
        : 'This page opens payment links from Tenantry. The link you followed has no payment to open.'}
    </p>
  );
}
