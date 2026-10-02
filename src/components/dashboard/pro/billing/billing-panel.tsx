import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { BillingCard } from '@/components/dashboard/pro/billing/billing-card';
import type { BillingView, NoSubscriptionView } from '@/server/billing/pro-pages';

/**
 * Billing (/dashboard/pro/billing): the subscription card, for anyone with a billing account, entitled or not. A
 * customer whose access ended still needs it: to update the payment method that failed, or for their invoices.
 */
export function BillingPanel({ view }: Readonly<{ view: BillingView | NoSubscriptionView }>) {
  if (view.noSubscription) return <NoSubscription view={view} />;

  return (
    <div className={'max-w-3xl'}>
      <BillingCard access={view.access} subscriptions={view.subscriptions} />
    </div>
  );
}
