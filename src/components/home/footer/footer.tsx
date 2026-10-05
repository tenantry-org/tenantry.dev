import Link from 'next/link';
import { cacheLife } from 'next/cache';
import { Logo } from '@/components/brand/logo';
import { LegalEntity, legalEntityIncomplete } from '@/constants/legal-entity';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Tenantry Pro', href: '/pro' },
      { label: 'Pricing', href: '/#pricing' },
      { label: 'Blog', href: '/blog' },
      { label: 'Core on GitHub', href: 'https://github.com/tenantry-org/tenantry-core', external: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Refunds', href: '/legal/refunds' },
      { label: 'EULA', href: '/legal/eula' },
    ],
  },
];

export function Footer() {
  return (
    <footer className={'border-t border-border/70 bg-background'}>
      <div className={'mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1fr_auto_auto] md:gap-20 md:px-8'}>
        <div className={'flex flex-col gap-4'}>
          <Link href={'/'} aria-label={'Tenantry home'} className={'w-fit text-foreground'}>
            <Logo className={'h-6'} />
          </Link>
          <p className={'max-w-xs text-sm text-muted-foreground'}>Multi-tenancy for ASP.NET Core and EF Core.</p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className={'flex flex-col gap-3 text-sm'}>
            <h2 className={'font-semibold'}>{column.title}</h2>
            {column.links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                target={'external' in link ? '_blank' : undefined}
                rel={'external' in link ? 'noopener noreferrer' : undefined}
                className={'text-muted-foreground transition-colors hover:text-foreground'}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className={'border-t border-border/70'}>
        <p className={'mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground md:px-8'}>
          © <CopyrightYear /> {legalEntityIncomplete() ? 'Tenantry' : LegalEntity.name}. Tenantry Pro is sold through
          our merchant of record, Paddle.com.
        </p>
      </div>
    </footer>
  );
}

// Cached so the footer prerenders with the page; it refreshes daily, so the year turns over on its own.
// prettier-ignore
async function CopyrightYear() { // NOSONAR: a 'use cache' function must be async, even with nothing to await
  'use cache';
  cacheLife('days');
  return new Date().getFullYear();
}
