import { Suspense } from 'react';
import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch';
import { Skeleton } from '@/components/ui/skeleton';
import { LogoutButton } from '@/components/dashboard/layout/logout-button';
import { getCurrentUser } from '@/utils/supabase/current-user';

export function SidebarUserInfo() {
  return (
    <div className={'flex flex-col gap-4 border-t border-border px-4 py-5 text-sm'}>
      <ThemeSwitch mode={'light-dark-system'} className={'w-fit'} />
      <div className={'flex w-full flex-row items-center justify-between gap-3'}>
        <Suspense fallback={<Skeleton className={'h-10 w-40'} />}>
          <UserDetails />
        </Suspense>
        <LogoutButton />
      </div>
    </div>
  );
}

async function UserDetails() {
  const user = await getCurrentUser();
  return (
    <div className={'flex min-w-0 flex-col items-start justify-center'}>
      <div className={'w-full truncate text-sm leading-5 font-semibold'}>{user?.user_metadata?.full_name}</div>
      <div className={'w-full truncate text-sm leading-5 text-muted-foreground'}>{user?.email}</div>
    </div>
  );
}
