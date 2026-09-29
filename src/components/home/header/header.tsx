import Link from 'next/link';
import { Suspense } from 'react';
import { AccountButton, SignInButton } from '@/components/home/header/account-button';
import { Logo } from '@/components/brand/logo';

const NAV = [
  { label: 'Docs', href: '/docs' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'GitHub', href: 'https://github.com/tenantry-org/tenantry-core', external: true },
];

export default function Header() {
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
                href={item.href}
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
          <Suspense fallback={<SignInButton />}>
            <AccountButton />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
