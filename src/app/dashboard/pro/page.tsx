import { DashboardPageHeader } from '@/components/dashboard/layout/dashboard-page-header';
import { getProAccess } from '@/utils/entitlements/get-entitlement';
import { ProAccessView } from '@/components/dashboard/pro/pro-access-view';
import { requireEnv } from '@/utils/config/env';
import { createClient } from '@/utils/supabase/server';

export default async function ProAccessPage({ searchParams }: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const { error } = await searchParams;
  const access = await getProAccess();
  const githubOrg = requireEnv('GITHUB_ORG');
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-8">
      <DashboardPageHeader pageTitle={'Tenantry Pro access'} />
      <ProAccessView access={access} githubOrg={githubOrg} linkError={error} accountEmail={user?.email ?? null} />
    </main>
  );
}
