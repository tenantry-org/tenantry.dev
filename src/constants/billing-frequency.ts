import type { OfferPrices } from '@/lib/public-config';

export interface IBillingFrequency {
  value: keyof OfferPrices;
  label: string;
  priceSuffix: string;
}

export const BillingFrequency: IBillingFrequency[] = [
  { value: 'month', label: 'Monthly', priceSuffix: 'per month' },
  { value: 'year', label: 'Annual', priceSuffix: 'per year' },
];
