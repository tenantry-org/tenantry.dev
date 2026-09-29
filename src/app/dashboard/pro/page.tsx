import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { getProAccess } from '@/utils/entitlements/get-entitlement';
import { ProAccessView } from '@/components/dashboard/pro/pro-access-view';
import { requireEnv } from '@/utils/config/env';
import { getCurrentUser } from '@/utils/supabase/current-user';

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default function ProAccessPage({ searchParams }: Props) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-8">
      <DashboardPageHeader pageTitle={'Tenantry Pro access'} />
      <Suspense fallback={<LoadingScreen />}>
        <ProAccess searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ProAccess({ searchParams }: Props) {
  const [{ error }, access, user] = await Promise.all([searchParams, getProAccess(), getCurrentUser()]);
  return (
    <ProAccessView
      access={access}
      githubOrg={requireEnv('GITHUB_ORG')}
      linkError={error}
      accountEmail={user?.email ?? null}
    />
  );
}
