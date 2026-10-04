import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { EntitlementCard } from '@/components/dashboard/pro/entitlement/entitlement-card';
import { FeedTokensCard } from '@/components/dashboard/pro/access/feed-tokens-card';
import { LicenceCard } from '@/components/dashboard/pro/access/licence-card';
import { type AccessView, FEED_TOKEN_LIMIT, type NoSubscriptionView } from '@/server/billing/pro-pages';

/**
 * Access (/dashboard/pro), for every customer, subscribed or not: which releases they may use, their feed tokens and
 * their licence key. A former customer keeps their key, and their tokens keep restoring the vested releases.
 */
export function AccessPanel({ view }: Readonly<{ view: AccessView | NoSubscriptionView }>) {
  if (view.noSubscription) return <NoSubscription view={view} />;

  return (
    <div className={'grid gap-6 lg:grid-cols-2'}>
      <div className={'flex flex-col gap-6'}>
        <EntitlementCard entitlement={view.entitlement} />
        <LicenceCard licenceKey={view.licenceKey} />
      </div>
      <FeedTokensCard tokens={view.tokens} canCreate={view.entitlement.canRestore} limit={FEED_TOKEN_LIMIT} />
    </div>
  );
}
