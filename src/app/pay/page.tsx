import { Suspense } from 'react';
import { CheckoutGradients } from '@/components/gradients/checkout-gradients';
import { PaymentLink } from '@/components/checkout/payment-link';
import '../../styles/checkout.css';

/**
 * Paddle's default payment link (set in Paddle → Checkout → Checkout settings for each environment): where
 * Paddle sends customers to pay an invoice, recover a failed renewal or update their card.
 */
export default function PayPage() {
  return (
    <main className={'w-full min-h-screen relative overflow-hidden'}>
      <CheckoutGradients />
      <div className={'relative min-h-screen px-4 flex items-center justify-center text-white'}>
        <Suspense>
          <PaymentLink />
        </Suspense>
      </div>
    </main>
  );
}
