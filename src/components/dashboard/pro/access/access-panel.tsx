import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { LicenceCard } from '@/components/dashboard/pro/access/licence-card';
import type { AccessView, NoSubscriptionView } from '@/server/billing/pro-pages';

interface Props {
  view: AccessView | NoSubscriptionView;
}

/**
 * Access (/dashboard/pro): the licence key. A former customer keeps their key, so it is shown below the way back to
 * Pro.
 */
export function AccessPanel({ view }: Readonly<Props>) {
  if (view.noSubscription) {
    if (!view.licenceKey) return <NoSubscription view={view} />;

    return (
      <div className={'grid gap-6 lg:grid-cols-2'}>
        <NoSubscription view={view} />
        <LicenceCard licenceKey={view.licenceKey} />
      </div>
    );
  }

  return (
    <div className={'grid gap-6 lg:grid-cols-2'}>
      <LicenceCard licenceKey={view.licenceKey} />
    </div>
  );
}
