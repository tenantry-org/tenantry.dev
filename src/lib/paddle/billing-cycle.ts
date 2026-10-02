import { CheckoutEventsTimePeriod } from '@paddle/paddle-js';

const BillingCycleMap = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

const CustomBillingCycleMap = {
  day: 'days',
  week: 'weeks',
  month: 'months',
  year: 'years',
};

export function formatBillingCycle({ frequency, interval }: CheckoutEventsTimePeriod) {
  if (frequency === 1) {
    return BillingCycleMap[interval];
  } else {
    return `every ${frequency} ${CustomBillingCycleMap[interval]}`;
  }
}
