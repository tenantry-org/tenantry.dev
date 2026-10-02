import type { BillingInterval } from '@/lib/public-config';

/** A choice on the pricing toggle, and how the price is labelled while it is chosen. */
export interface BillingIntervalOption {
  interval: BillingInterval;
  label: string;
  priceSuffix: string;
}

export const BILLING_INTERVALS: BillingIntervalOption[] = [
  { interval: 'month', label: 'Monthly', priceSuffix: 'per month' },
  { interval: 'year', label: 'Annual', priceSuffix: 'per year' },
];
