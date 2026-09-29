import { Suspense } from 'react';
import { SimpleHeader } from '@/components/shared/simple-header';
import { PaymentLink } from '@/components/checkout/payment-link';

/**
 * Paddle's default payment link (set in Paddle → Checkout → Checkout settings for each environment): where
 * Paddle sends customers to pay an invoice, recover a failed renewal or update their card.
 */
export default function PayPage() {
  return (
    <div className={'flex min-h-screen flex-col bg-surface'}>
      <SimpleHeader />
      <main className={'flex flex-1 items-center justify-center px-4 py-20'}>
        <Suspense>
          <PaymentLink />
        </Suspense>
      </main>
    </div>
  );
}
