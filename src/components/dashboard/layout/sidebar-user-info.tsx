import { Suspense } from 'react';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { LogoutButton } from '@/components/dashboard/layout/logout-button';
import { getCurrentUser } from '@/utils/supabase/current-user';

export function SidebarUserInfo() {
  return (
    <div className={'flex flex-col items-start pb-8 px-2 text-sm font-medium lg:px-4'}>
      <Separator className={'relative mt-6 dashboard-sidebar-highlight bg-[#283031]'} />
      <div className={'flex w-full flex-row mt-6 items-center justify-between'}>
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
    <div className={'flex flex-col items-start justify-center overflow-hidden text-ellipsis'}>
      <div className={'text-sm leading-5 font-semibold w-full overflow-hidden text-ellipsis'}>
        {user?.user_metadata?.full_name}
      </div>
      <div className={'text-sm leading-5 text-muted-foreground w-full overflow-hidden text-ellipsis'}>
        {user?.email}
      </div>
    </div>
  );
}
