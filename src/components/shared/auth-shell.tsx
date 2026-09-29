import Link from 'next/link';
import { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

/** The frame of the sign-in and sign-up pages: the logo, a card with the form, and a line below it. */
export function AuthShell({ children, footer }: Readonly<{ children: ReactNode; footer: ReactNode }>) {
  return (
    <main className={'flex min-h-screen flex-col items-center bg-surface px-4 py-12 md:py-20'}>
      <Link href={'/'} aria-label={'Tenantry home'} className={'text-foreground'}>
        <Logo className={'h-8'} />
      </Link>
      <div className={'mt-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm md:p-8'}>
        {children}
      </div>
      <div className={'mt-6 text-center text-sm text-muted-foreground'}>{footer}</div>
    </main>
  );
}
