import { ReactNode, Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard/layout/dashboard-layout';
import DashboardLoading from '@/app/dashboard/loading';
import { getCurrentUser } from '@/server/db/current-user';

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

// The proxy (update-session.ts) sends a signed-out request to the login page with the page to return to. This check
// catches only what the proxy let through, such as a session that ends in between, and a layout is not given the
// requested path, so it sends no `next`.
async function SignedIn({ children }: Props) {
  if (!(await getCurrentUser())) redirect('/login');
  return children;
}
