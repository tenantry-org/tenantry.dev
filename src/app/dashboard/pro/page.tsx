import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { getProAccess } from '@/utils/entitlements/get-entitlement';
import { AccessView } from '@/components/dashboard/pro/pro-access-view';
import { requireEnv } from '@/utils/config/env';
import { getCurrentUser } from '@/utils/supabase/current-user';

// The Connect GitHub action runs here and holds the customer's lease, which must outlast it (customer-lease.ts).
export const maxDuration = 60;

interface Props {
  searchParams: Promise<{ error?: string }>;
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
  const [{ error }, access, user] = await Promise.all([searchParams, getProAccess(), getCurrentUser()]);
  return (
    <AccessView
      access={access}
      githubOrg={requireEnv('GITHUB_ORG')}
      linkError={error}
      accountEmail={user?.email ?? null}
    />
  );
}
