import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { getProAccess } from '@/utils/entitlements/get-entitlement';
import { BillingView } from '@/components/dashboard/pro/pro-access-view';
import { getCurrentUser } from '@/utils/supabase/current-user';

export default function BillingPage() {
  return (
    <main className="flex flex-1 flex-col p-4 lg:p-8">
      <DashboardPageHeader pageTitle={'Billing'} />
      <Suspense fallback={<LoadingScreen />}>
        <Billing />
      </Suspense>
    </main>
  );
}

async function Billing() {
  const [access, user] = await Promise.all([getProAccess(), getCurrentUser()]);
  return <BillingView access={access} accountEmail={user?.email ?? null} />;
}
