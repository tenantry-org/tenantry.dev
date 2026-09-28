import { CheckoutGradients } from '@/components/gradients/checkout-gradients';
import '../../../styles/checkout.css';
import { CheckoutHeader } from '@/components/checkout/checkout-header';
import { CheckoutContents } from '@/components/checkout/checkout-contents';
import { createClient } from '@/utils/supabase/server';
import { checkoutEnabled, isOfferPrice } from '@/constants/pro-offer';
import { notFound } from 'next/navigation';

export default async function CheckoutPage({ params }: Readonly<{ params: Promise<{ priceId: string }> }>) {
  // Only the Pro offer's prices are for sale; any other price would take a payment that entitles nothing.
  if (!checkoutEnabled || !isOfferPrice((await params).priceId)) notFound();

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return (
    <div className={'w-full min-h-screen relative overflow-hidden'}>
      <CheckoutGradients />
      <div
        className={'mx-auto max-w-6xl relative px-[16px] md:px-[32px] py-[24px] flex flex-col gap-6 justify-between'}
      >
        <CheckoutHeader />
        <CheckoutContents userEmail={data.user?.email} />
      </div>
    </div>
  );
}
