'use client';

import { CreditCard, KeyRound, Package } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { cn } from '@/lib/utils';

const sidebarItems = [
  { title: 'Access', icon: <KeyRound className={'h-4 w-4'} />, href: '/dashboard/pro' },
  { title: 'Install', icon: <Package className={'h-4 w-4'} />, href: '/dashboard/pro/install' },
  { title: 'Billing', icon: <CreditCard className={'h-4 w-4'} />, href: '/dashboard/pro/billing' },
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
    <nav className={'flex grow flex-col items-start px-3 text-sm font-medium'}>
      <div className={'flex w-full flex-col gap-1'}>
        {sidebarItems.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            aria-current={pathname === item.href ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              pathname === item.href && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {item.icon}
            {item.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}
