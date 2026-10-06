import type { BillingInterval } from '@/lib/public-config';

/** Pro's price for each billing interval as Paddle holds it, before it is localised for a visitor: '£15'. */
export type BasePrices = Record<BillingInterval, string>;

/** Said wherever the base price stands in for the visitor's own. */
export const CHECKOUT_PRICE_NOTE = 'The checkout shows the price in your currency, with any tax.';

/**
 * A Paddle amount, in the currency's lowest unit as Paddle gives it ('1500' for £15.00), formatted without a zero
 * fraction: '£15', '£15.50', '¥1,500'.
 */
export function formatBasePrice(amount: string, currencyCode: string): string {
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).resolvedOptions()
    .maximumFractionDigits;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    trailingZeroDisplay: 'stripIfInteger',
  }).format(Number(amount) / 10 ** (digits ?? 2));
}

/** Pro's price as a sentence, for text that has no price card: the Pro page's questions and llms.txt. */
export function basePriceSentence(prices: BasePrices): string {
  return `Pro costs ${prices.month} a month or ${prices.year} a year for your whole company. ${CHECKOUT_PRICE_NOTE}`;
}
