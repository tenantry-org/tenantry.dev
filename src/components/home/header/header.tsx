import Link from 'next/link';
import { Suspense } from 'react';
import { AccountButton } from '@/components/home/header/account-button';
import { Logo } from '@/components/brand/logo';

const NAV = [
  { label: 'Docs', href: '/docs' },
  { label: 'Pro', href: '/pro' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Blog', href: '/blog' },
  { label: 'GitHub', href: 'https://github.com/tenantry-org/tenantry-core', external: true },
];

/** The site header; a page with its own pricing block passes `pricingHref` so Pricing stays on the page. */
export default function Header({ pricingHref = '/#pricing' }: Readonly<{ pricingHref?: string }>) {
  return (
    <header className={'sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md'}>
      <div className={'mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 md:px-8'}>
        <div className={'flex items-center gap-10'}>
          <Link href={'/'} aria-label={'Tenantry home'} className={'text-foreground'}>
            <Logo className={'h-7'} />
          </Link>
          <nav className={'hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex'}>
            {NAV.map((item) => (
              <Link
                key={item.label}
                className={'transition-colors hover:text-foreground'}
                href={item.label === 'Pricing' ? pricingHref : item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className={'flex items-center gap-3'}>
          <Link
            href={'/docs'}
            className={'text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:hidden'}
          >
            Docs
          </Link>
          {/* Until the session is read, hold the button's place without naming it: showing Sign in here made it
              flash for signed-in visitors. */}
          <Suspense fallback={<div className={'h-8 w-24'} aria-hidden={true} />}>
            <AccountButton />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
