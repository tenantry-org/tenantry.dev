import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { SimpleHeader } from '@/components/shared/simple-header';
import { CheckoutContents } from '@/components/checkout/checkout-contents';
import { Skeleton } from '@/components/ui/skeleton';
import { getCurrentUser } from '@/server/db/current-user';
import { isOfferPrice } from '@/constants/pro-offer';
import { publicConfig } from '@/lib/public-config';

interface Props {
  params: Promise<{ priceId: string }>;
}

// The page sells what the pricing section offers, so it reads the same compiled public configuration. Its shell
// prerenders during the build, where the server's configuration is not read.
export default function CheckoutPage({ params }: Props) {
  if (!publicConfig().checkoutEnabled) notFound();

  return (
    <div className={'min-h-screen bg-surface'}>
      <SimpleHeader backHref={'/#pricing'} backLabel={'Back to pricing'} />
      <main className={'mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-16'}>
        <Suspense fallback={<Skeleton className={'h-[600px] w-full rounded-xl'} />}>
          <Checkout params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function Checkout({ params }: Props) {
  const { priceId } = await params;
  // Only the Pro offer's prices are for sale; any other price would take a payment that entitles nothing.
  if (!isOfferPrice(priceId)) notFound();

  // Buyers sign in first, so the subscription is theirs from the start: the checkout uses their account's email,
  // which is what purchases are matched by, and the success page can send them straight to create a feed token.
  const user = await getCurrentUser();
  if (!user?.email) redirect(`/signup?next=${encodeURIComponent(`/checkout/${priceId}`)}`);

  // Keyed by price, so another price gets a checkout of its own.
  return <CheckoutContents key={priceId} priceId={priceId} userEmail={user.email} />;
}
