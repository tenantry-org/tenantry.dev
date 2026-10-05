import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { BillingCard } from '@/components/dashboard/pro/billing/billing-card';
import { EntitlementCard } from '@/components/dashboard/pro/entitlement/entitlement-card';
import type { BillingView, NoSubscriptionView } from '@/server/billing/pro-pages';

/**
 * Billing (/dashboard/pro/billing): the subscription card, for anyone with a billing account, entitled or not, beside
 * the releases they may use, as the Access page shows them. A customer whose access ended still needs it: to update
 * the payment method that failed, or for their invoices.
 */
export function BillingPanel({ view }: Readonly<{ view: BillingView | NoSubscriptionView }>) {
  if (view.noSubscription) return <NoSubscription view={view} />;

  return (
    <div className={'grid max-w-5xl gap-6 lg:grid-cols-2'}>
      <BillingCard entitlement={view.entitlement} subscriptions={view.subscriptions} />
      <EntitlementCard entitlement={view.entitlement} />
    </div>
  );
}
