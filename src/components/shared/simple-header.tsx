import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Logo } from '@/components/brand/logo';

/** A slim header for pages outside the main site: checkout, payment links, legal documents. */
export function SimpleHeader({
  backHref = '/',
  backLabel = 'Back to Tenantry',
}: Readonly<{ backHref?: string; backLabel?: string }>) {
  return (
    <header className={'border-b border-border/70 bg-background'}>
      <div className={'mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-8'}>
        <Link href={'/'} aria-label={'Tenantry home'} className={'text-foreground'}>
          <Logo className={'h-6'} />
        </Link>
        <Link
          href={backHref}
          className={
            'inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
          }
        >
          <ChevronLeft className={'h-4 w-4'} /> {backLabel}
        </Link>
      </div>
    </header>
  );
}
