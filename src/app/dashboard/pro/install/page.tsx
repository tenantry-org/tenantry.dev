import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { InstallPanel } from '@/components/dashboard/pro/install/install-panel';
import { getInstallView } from '@/server/billing/pro-pages';
import { serverConfig } from '@/server/config/server-config';

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
  const view = await getInstallView();
  return <InstallPanel view={view} siteUrl={serverConfig().siteUrl} />;
}
