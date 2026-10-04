import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { AccessPanel } from '@/components/dashboard/pro/access/access-panel';
import { getAccessView } from '@/server/billing/pro-pages';

export default function AccessPage() {
  return (
    <main className="flex flex-1 flex-col p-4 lg:p-8">
      <DashboardPageHeader pageTitle={'Access'} />
      <Suspense fallback={<LoadingScreen />}>
        <Access />
      </Suspense>
    </main>
  );
}

async function Access() {
  return <AccessPanel view={await getAccessView()} />;
}
