import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { getProAccess } from '@/utils/entitlements/get-entitlement';
import { InstallView } from '@/components/dashboard/pro/pro-access-view';
import { requireEnv } from '@/utils/config/env';
import { getCurrentUser } from '@/utils/supabase/current-user';

export default function InstallPage() {
  return (
    <main className="flex flex-1 flex-col p-4 lg:p-8">
      <DashboardPageHeader pageTitle={'Install'} />
      <Suspense fallback={<LoadingScreen />}>
        <Install />
      </Suspense>
    </main>
  );
}

async function Install() {
  const [access, user] = await Promise.all([getProAccess(), getCurrentUser()]);
  return <InstallView access={access} githubOrg={requireEnv('GITHUB_ORG')} accountEmail={user?.email ?? null} />;
}
