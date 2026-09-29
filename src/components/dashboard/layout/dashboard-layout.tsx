import Link from 'next/link';
import { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { Sidebar } from '@/components/dashboard/layout/sidebar';
import { SidebarUserInfo } from '@/components/dashboard/layout/sidebar-user-info';
import { MobileSidebar } from '@/components/dashboard/layout/mobile-sidebar';

interface Props {
  children: ReactNode;
}

export function DashboardLayout({ children }: Props) {
  return (
    <div className={'grid min-h-screen w-full md:grid-cols-[240px_1fr] lg:grid-cols-[272px_1fr]'}>
      <aside className={'hidden border-r border-border bg-surface md:block'}>
        <div className={'sticky top-0 flex h-screen flex-col'}>
          <div className={'flex h-16 items-center px-6'}>
            <Link href={'/'} aria-label={'Tenantry home'} className={'text-foreground'}>
              <Logo className={'h-6'} />
            </Link>
          </div>
          <div className={'flex grow flex-col'}>
            <Sidebar />
            <SidebarUserInfo />
          </div>
        </div>
      </aside>
      <div className={'flex min-w-0 flex-col'}>
        <div className={'flex h-16 items-center gap-3 border-b border-border px-4 md:hidden'}>
          <MobileSidebar />
          <Link href={'/'} aria-label={'Tenantry home'} className={'text-foreground'}>
            <Logo className={'h-6'} />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
