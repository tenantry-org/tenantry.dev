'use client';

import { useSearchParams } from 'next/navigation';
import { usePaddle } from '@/hooks/use-paddle';

/**
 * Opens the checkout for a transaction Paddle created (`?_ptxn=txn_…`): the invoice, renewal and
 * payment-method links Paddle sends customers. Paddle.js opens that transaction's checkout by itself once
 * initialised, so this only initialises it. It cannot start a new purchase, so it is not behind
 * NEXT_PUBLIC_CHECKOUT_ENABLED.
 */
export function PaymentLink() {
  const transactionId = useSearchParams().get('_ptxn');

  return (
    <p className={'max-w-md text-center text-lg text-muted-foreground'}>
      {transactionId ? (
        <OpenTransaction />
      ) : (
        'This page opens payment links from Tenantry. The link you followed has no payment to open.'
      )}
    </p>
  );
}

function OpenTransaction() {
  const paddle = usePaddle(() => ({
    checkout: {
      settings: {
        displayMode: 'overlay',
        theme: 'dark',
        // The success page thanks a new subscriber unless told the checkout came from here.
        successUrl: `${window.location.origin}/checkout/success?from=pay`,
      },
    },
  }));

  return paddle.status === 'failed'
    ? 'The checkout could not be loaded. Refresh the page to try again.'
    : 'Opening the secure Paddle checkout…';
}
