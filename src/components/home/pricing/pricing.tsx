import { Suspense } from 'react';
import { PricingSection } from '@/components/home/pricing/pricing-section';
import { basePricesOrNull } from '@/server/integrations/paddle/get-base-prices';

/**
 * The pricing block; `proLink` links the Pro card to /pro, which the Pro page itself leaves out. Pro's base price is
 * read from Paddle when the page is requested and streamed into it, so the page's HTML states the price before
 * Paddle.js loads, and without it. The prerendered shell has the block without it.
 */
export function Pricing({ proLink = true }: Readonly<{ proLink?: boolean }>) {
  return (
    <Suspense fallback={<PricingSection basePrices={null} proLink={proLink} />}>
      <PricingWithBasePrices proLink={proLink} />
    </Suspense>
  );
}

async function PricingWithBasePrices({ proLink }: Readonly<{ proLink: boolean }>) {
  return <PricingSection basePrices={await basePricesOrNull()} proLink={proLink} />;
}
