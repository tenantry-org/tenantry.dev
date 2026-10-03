import Link from 'next/link';
import { ArrowRight, Check, Layers, ServerCog, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { ProOffer } from '@/constants/pro-offer';
import { cn } from '@/lib/utils';

// From Tenantry Core's README ("Why Tenantry?" and "Tenantry and Tenantry.Pro"), for the release the docs show.
const PRINCIPLES = [
  {
    icon: Layers,
    title: 'Your DbContext stays yours',
    text: 'One call, options.UseTenantry(), isolates any DbContext: no base class, no interface, no SaveChanges override. Pooled contexts too, with a database per tenant.',
  },
  {
    icon: ShieldCheck,
    title: 'Fails closed',
    text: 'With no tenant, queries match nothing. Writes to another tenant’s rows are rejected before saving, and the stored tenant is part of every UPDATE and DELETE, so a forged key changes nothing.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Your keys, your registry',
    text: 'A Guid, int, string or any parsable tenant key. Resolve it from a header, subdomain, route, claim or query string, and keep your tenants where they already are.',
  },
  {
    icon: ServerCog,
    title: 'HTTP and beyond',
    text: 'ASP.NET Core middleware and access validation, and the same isolation in workers, console and desktop apps. .NET 10, and .NET 8 and 9 until November 2027; Native AOT for the core and ASP.NET Core packages.',
  },
];

// What Core is, beyond the principles above.
const CORE = [
  'A shared database, or a database per tenant with pooled contexts',
  'Tenant resolution, your tenant store and access validation',
  'Worker scopes for background work as a tenant',
];

function Edition({
  name,
  badge,
  summary,
  items,
  links,
  featured = false,
}: Readonly<{
  name: string;
  badge: string;
  summary: string;
  items: string[];
  links: { label: string; href: string }[];
  featured?: boolean;
}>) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-card p-8',
        featured ? 'border-primary/40 ring-4 ring-primary/5' : 'border-border',
      )}
    >
      <div className={'flex items-center justify-between gap-4'}>
        <div className={'flex items-center gap-3'}>
          <LogoMark className={'h-7'} />
          <h3 className={'text-xl font-semibold'}>{name}</h3>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            featured ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {badge}
        </span>
      </div>
      <p className={'mt-4 text-muted-foreground'}>{summary}</p>
      <ul className={'mt-6 flex flex-1 flex-col gap-3 text-sm'}>
        {items.map((item) => (
          <li key={item} className={'flex gap-3'}>
            <Check className={'mt-0.5 h-4 w-4 shrink-0 text-link'} aria-hidden={true} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className={'mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium'}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={'inline-flex items-center gap-1 text-link hover:underline'}>
            {link.label} <ArrowRight className={'h-3.5 w-3.5'} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section className={'mx-auto max-w-6xl px-4 py-20 md:px-8 md:py-24'}>
      <div className={'grid gap-8 sm:grid-cols-2 lg:grid-cols-4'}>
        {PRINCIPLES.map(({ icon: Icon, title, text }) => (
          <div key={title}>
            <div className={'flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground'}>
              <Icon className={'h-5 w-5'} aria-hidden={true} />
            </div>
            <h3 className={'mt-4 font-semibold'}>{title}</h3>
            <p className={'mt-2 text-sm leading-relaxed text-muted-foreground'}>{text}</p>
          </div>
        ))}
      </div>

      <div className={'mt-24 max-w-2xl'}>
        <h2 className={'text-3xl font-bold tracking-tight md:text-4xl'}>Open-source Core. Pro for running tenants.</h2>
        <p className={'mt-4 text-lg text-muted-foreground'}>
          Core is free and complete for isolating tenant data. Pro is for running a database or schema per tenant:
          provisioning, migrations, jobs and audit.
        </p>
      </div>
      <div className={'mt-10 grid gap-6 lg:grid-cols-2'}>
        <Edition
          name={'Tenantry Core'}
          badge={'Free · Apache-2.0'}
          summary={'Tenant resolution and EF Core isolation, in a shared database or a database per tenant.'}
          items={CORE}
          links={[
            { label: 'Core docs', href: '/docs/core' },
            { label: 'GitHub', href: 'https://github.com/tenantry-org/tenantry-core' },
          ]}
        />
        <Edition
          name={'Tenantry Pro'}
          badge={'Subscription'}
          summary={ProOffer.description}
          items={ProOffer.features}
          links={[
            { label: 'What Pro adds', href: '/pro' },
            { label: 'Pro docs', href: '/docs/pro' },
          ]}
          featured={true}
        />
      </div>
    </section>
  );
}
