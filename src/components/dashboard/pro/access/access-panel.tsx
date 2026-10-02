import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { GithubCard } from '@/components/dashboard/pro/access/github-card';
import { LicenceCard } from '@/components/dashboard/pro/access/licence-card';
import type { AccessView, NoSubscriptionView } from '@/server/billing/pro-pages';
import type { LinkErrorCode } from '@/lib/link-errors';

interface Props {
  view: AccessView | NoSubscriptionView;
  githubOrg: string;
  /** Why connecting GitHub failed, if it just did. */
  linkError?: LinkErrorCode;
}

/** Access (/dashboard/pro): the GitHub connection and the licence key. */
export function AccessPanel({ view, githubOrg, linkError }: Readonly<Props>) {
  if (view.noSubscription) return <NoSubscription view={view} />;

  return (
    <div className={'grid gap-6 lg:grid-cols-2'}>
      <GithubCard github={view.github} githubOrg={githubOrg} linkError={linkError} />
      <LicenceCard licenceKey={view.licenceKey} />
    </div>
  );
}
