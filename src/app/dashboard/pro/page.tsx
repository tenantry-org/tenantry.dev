import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { AccessPanel } from '@/components/dashboard/pro/access/access-panel';
import { getAccessView } from '@/server/billing/pro-pages';
import { serverConfig } from '@/server/config/server-config';
import { isLinkErrorCode } from '@/lib/link-errors';

// The Connect GitHub action runs here and holds the customer's lease, which must outlast it (customer-lease.ts).
export const maxDuration = 60;

interface Props {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default function AccessPage({ searchParams }: Props) {
  return (
    <main className="flex flex-1 flex-col p-4 lg:p-8">
      <DashboardPageHeader pageTitle={'Access'} />
      <Suspense fallback={<LoadingScreen />}>
        <Access searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Access({ searchParams }: Props) {
  const [{ error }, view] = await Promise.all([searchParams, getAccessView()]);
  return (
    <AccessPanel
      view={view}
      githubOrg={serverConfig().github.org}
      linkError={isLinkErrorCode(error) ? error : undefined}
    />
  );
}
