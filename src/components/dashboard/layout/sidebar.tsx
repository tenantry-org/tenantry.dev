'use client';

import { Album, CreditCard, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const sidebarItems = [
  {
    title: 'Pro access',
    icon: <KeyRound className="h-6 w-6" />,
    href: '/dashboard/pro',
  },
  {
    title: 'Subscriptions',
    icon: <Album className="h-6 w-6" />,
    href: '/dashboard/subscriptions',
  },
  {
    title: 'Payments',
    icon: <CreditCard className="h-6 w-6" />,
    href: '/dashboard/payments',
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col grow justify-between items-start px-2 text-sm font-medium lg:px-4">
      <div className={'w-full'}>
        {sidebarItems.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className={cn('flex items-center text-base gap-3 px-4 py-3 rounded-xxs dashboard-sidebar-items', {
              'dashboard-sidebar-items-active': pathname.startsWith(item.href),
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
