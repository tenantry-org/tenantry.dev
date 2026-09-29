import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { ArrowUpRight } from 'lucide-react';
import { cacheLife } from 'next/cache';
import { LegalEntity, legalEntityIncomplete } from '@/constants/legal-entity';

const resourceLinks = [
  { label: 'Docs', href: '/docs' },
  { label: 'Core on GitHub', href: 'https://github.com/tenantry-org/tenantry-core', external: true },
  { label: 'Pricing', href: '/#pricing' },
];

const legalLinks = [
  { label: 'Terms', href: '/legal/terms' },
  { label: 'Privacy', href: '/legal/privacy' },
  { label: 'Refunds', href: '/legal/refunds' },
  { label: 'EULA', href: '/legal/eula' },
];

export function PoweredByPaddle() {
  return (
    <>
      <Separator className={'footer-border'} />
      <div
        className={
          'flex flex-col justify-center items-center gap-4 text-muted-foreground text-sm leading-[14px] py-[24px]'
        }
      >
        <div className={'flex justify-center items-center gap-4 flex-wrap'}>
          {resourceLinks.map((link) => (
            <Link
              key={link.label}
              className={'hover:text-primary'}
              href={link.href}
              target={link.external ? '_blank' : undefined}
            >
              <span className={'flex items-center gap-1'}>
                {link.label}
                {link.external ? <ArrowUpRight className={'h-4 w-4'} /> : null}
              </span>
            </Link>
          ))}
        </div>
        <div className={'flex justify-center items-center gap-4 flex-wrap'}>
          {legalLinks.map((link) => (
            <Link key={link.label} className={'hover:text-primary'} href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        <div className={'flex justify-center items-center gap-1 text-xs'}>
          <span>
            © <CopyrightYear /> {legalEntityIncomplete() ? 'Tenantry' : LegalEntity.name} · Payments &amp; billing
            handled by Paddle.com
          </span>
        </div>
      </div>
    </>
  );
}

// Cached so the footer prerenders with the page; it refreshes daily, so the year turns over on its own.
// prettier-ignore
async function CopyrightYear() { // NOSONAR: a 'use cache' function must be async, even with nothing to await
  'use cache';
  cacheLife('days');
  return new Date().getFullYear();
}
