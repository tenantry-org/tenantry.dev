'use client';

import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { cn } from '@/lib/utils';

const sidebarItems = [
  {
    title: 'Pro access',
    icon: <KeyRound className="h-6 w-6" />,
    href: '/dashboard/pro',
  },
];

// The current page is only known at request time on dynamic routes, so the prerendered shell shows the links
// without a highlight and the highlighted version streams in.
export function Sidebar() {
  return (
    <Suspense fallback={<SidebarLinks pathname={null} />}>
      <CurrentSidebarLinks />
    </Suspense>
  );
}

function CurrentSidebarLinks() {
  return <SidebarLinks pathname={usePathname()} />;
}

function SidebarLinks({ pathname }: Readonly<{ pathname: string | null }>) {
  return (
    <nav className="flex flex-col grow justify-between items-start px-2 text-sm font-medium lg:px-4">
      <div className={'w-full'}>
        {sidebarItems.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            aria-current={pathname?.startsWith(item.href) ? 'page' : undefined}
            className={cn('flex items-center text-base gap-3 px-4 py-3 rounded-xxs dashboard-sidebar-items', {
              'dashboard-sidebar-items-active': pathname?.startsWith(item.href),
            })}
          >
            {item.icon}
            {item.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}
