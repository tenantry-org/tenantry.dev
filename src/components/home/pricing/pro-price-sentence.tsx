import { basePriceSentence } from '@/lib/pro-price';
import { basePricesOrNull } from '@/server/integrations/paddle/get-base-prices';

/**
 * Pro's price as a sentence, followed by a space, read from Paddle when the page is requested; nothing when Paddle
 * cannot be read. Render it inside a Suspense boundary: the prerendered shell leaves it out.
 */
export async function ProPriceSentence() {
  const prices = await basePricesOrNull();
  return prices ? `${basePriceSentence(prices)} ` : null;
}
