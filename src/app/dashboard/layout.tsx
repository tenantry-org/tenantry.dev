import { ReactNode, Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard/layout/dashboard-layout';
import DashboardLoading from '@/app/dashboard/loading';
import { getCurrentUser } from '@/utils/supabase/current-user';

interface Props {
  children: ReactNode;
}

// The dashboard's frame is static and shows at once; the session check streams in with the page.
export default function Layout({ children }: Props) {
  return (
    <DashboardLayout>
      <Suspense fallback={<DashboardLoading />}>
        <SignedIn>{children}</SignedIn>
      </Suspense>
    </DashboardLayout>
  );
}

async function SignedIn({ children }: Props) {
  if (!(await getCurrentUser())) redirect('/login');
  return children;
}
