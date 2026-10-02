import { Suspense } from 'react';
import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { LoadingScreen } from '@/components/dashboard/layout/loading-screen';
import { BillingPanel } from '@/components/dashboard/pro/billing/billing-panel';
import { getBillingView } from '@/server/billing/pro-pages';

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
  return <BillingPanel view={await getBillingView()} />;
}
