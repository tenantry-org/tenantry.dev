import Link from 'next/link';
import { ArrowRight, Check, Database, ListChecks, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { DOTNET_SUPPORT } from '@/constants/dotnet-support';
import { ProOffer } from '@/constants/pro-offer';
import { publishedSince } from '@/lib/docs-versions';
import { cn } from '@/lib/utils';

// What is specific to Tenantry, from Tenantry Core's docs for the release the site shows: efcore-integration.md (write
// isolation, database per tenant, TenantModel), efcore-advanced.md (models that cannot be isolated), analyzers.md (from
// Core 0.7.0), tenant-resolution.md and access-control.md.
const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: 'Writes are checked, not only reads',
    text: 'SaveChanges refuses another tenant’s entity before anything is written. TenantId is a concurrency token, so an update or delete of another tenant’s row by its id matches no row and the save fails. ExecuteUpdate cannot set TenantId.',
  },
  {
    icon: Database,
    title: 'A database per tenant, pooled or not',
    text: 'AddDbContextPerTenantDatabase connects each context, or each pooled lease, to the current tenant’s database. Before the context opens a connection and before every command, a guard checks that the connection was set for the tenant current at that moment, and throws if not.',
  },
  {
    icon: ListChecks,
    // Core 0.7.0 adds the analyzers.
    title: publishedSince('core', 'v0.7.0') ? 'Model checks and build warnings' : 'Model checks',
    text: `UseTenantry() refuses a model it cannot isolate, such as a tenant-owned entity whose base type is not tenant-owned. TenantModel.FindUnisolatedEntityTypes lists the entity types still to mark tenant-owned or shared, for a test that fails when one is added.${publishedSince('core', 'v0.7.0') ? ' The build warns about an entity with a TenantId that is not tenant-owned (TNY1001), IgnoreQueryFilters() on a tenant-owned entity (TNY1002), and a tenant read from the request with no access validator (TNY2001).' : ''}`,
  },
  {
    icon: SlidersHorizontal,
    title: 'Your keys, your registry',
    text: 'A Guid, int, string or any parsable tenant key, resolved from a header, subdomain, host name, route value, claim or a resolver of your own, and found in your own store by id, slug or custom domain. Access validation refuses a request for a tenant the caller does not belong to.',
  },
];

// What Core is, beyond the principles above.
const CORE = [
  'Tenant resolution, your tenant store and access validation',
  'Suspended tenants refused in requests and in RunInScopeAsync (ValidateTenantActivity)',
  'Worker scopes for background work as a tenant, and the same isolation in console and desktop apps',
  'Options per tenant, authentication settings included (Tenantry.Options)',
  'HybridCache and IDistributedCache entries (Tenantry.Caching) and cached responses kept per tenant',
  'ITenantInvalidator, which clears what Tenantry keeps for a tenant when the tenant changes',
  'The current tenant sent with HttpClient and gRPC calls, and read back only from callers you trust (Tenantry.Http, Tenantry.AspNetCore)',
  // Core 0.7.0 tags ASP.NET Core's request metric with the tenant (tenant.TagRequestMetrics()).
  `Log event ids to alert on, a tenant.id tag on traces, and ${publishedSince('core', 'v0.7.0') ? 'request metrics per tenant' : 'a count of how requests were resolved'}`,
  'A model check that refuses mappings it cannot isolate, and a list of unisolated entity types for your tests',
  `${DOTNET_SUPPORT}; Native AOT for every Core package except Tenantry.EfCore`,
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
          With a shared database or a database per tenant, everything that keeps one tenant’s data from another’s is in
          Core, which is free: access validation, the query filters and write checks, the connection checks for a
          database per tenant, caches and options kept per tenant, and the model checks. Pro adds a schema per tenant
          and mixed mode, with the checks those layouts need, and the operations around tenants: the tenant in Hangfire,
          Quartz.NET, MassTransit and Rebus work, audit logging, offboarding, and creating, migrating and checking
          tenant databases and schemas.
        </p>
      </div>
      <div className={'mt-10 grid gap-6 lg:grid-cols-2'}>
        <Edition
          name={'Tenantry Core'}
          badge={'Free · Apache-2.0'}
          summary={'Tenant resolution and EF Core isolation for an existing application.'}
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
