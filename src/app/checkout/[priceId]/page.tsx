import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { CheckoutGradients } from '@/components/gradients/checkout-gradients';
import '../../../styles/checkout.css';
import { CheckoutHeader } from '@/components/checkout/checkout-header';
import { CheckoutContents } from '@/components/checkout/checkout-contents';
import { Skeleton } from '@/components/ui/skeleton';
import { getCurrentUser } from '@/utils/supabase/current-user';
import { checkoutEnabled, isOfferPrice } from '@/constants/pro-offer';

interface Props {
  params: Promise<{ priceId: string }>;
}

export default function CheckoutPage({ params }: Props) {
  if (!checkoutEnabled) notFound();

  return (
    <div className={'w-full min-h-screen relative overflow-hidden'}>
      <CheckoutGradients />
      <div
        className={'mx-auto max-w-6xl relative px-[16px] md:px-[32px] py-[24px] flex flex-col gap-6 justify-between'}
      >
        <CheckoutHeader />
        <Suspense fallback={<Skeleton className={'h-[600px] w-full rounded-lg'} />}>
          <Checkout params={params} />
        </Suspense>
      </div>
    </div>
  );
}

async function Checkout({ params }: Props) {
  const { priceId } = await params;
  // Only the Pro offer's prices are for sale; any other price would take a payment that entitles nothing.
  if (!isOfferPrice(priceId)) notFound();

  const user = await getCurrentUser();
  return <CheckoutContents priceId={priceId} userEmail={user?.email} />;
}
