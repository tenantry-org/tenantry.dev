import type { ReactNode } from 'react';
import Link from 'next/link';
import { publishedSince } from '@/lib/docs-versions';

// Checked in October 2026 against Finbuckle.MultiTenant 10.1.4 and ABP 10.6.1 (the documents in SOURCES, their source
// and their packages) and against Tenantry Core and Pro 0.8. Check them again when any of them releases a major
// version. A row whose Finbuckle or ABP cell the sources do not support is left out, not filled in.
const PROJECTS = ['Your own query filters', 'Finbuckle.MultiTenant', 'ABP', 'Tenantry'] as const;

const ROWS: { label: string; cells: [ReactNode, ReactNode, ReactNode, ReactNode]; fullOnly?: boolean }[] = [
  {
    label: 'What your DbContext needs',
    cells: [
      'A filter on each entity, and a SaveChanges override',
      'Derive from MultiTenantDbContext, or implement IMultiTenantDbContext, configure entities in OnModelCreating and call EnforceMultiTenant() in SaveChanges',
      'Derive from AbpDbContext and register it with AddAbpDbContext, in an ABP application',
      'One call, options.UseTenantry()',
    ],
  },
  {
    label: 'Saving an entity with another tenant’s TenantId',
    cells: [
      'Whatever your SaveChanges override checks',
      'Throws by default; TenantMismatchMode can ignore or overwrite it instead',
      'Saved with that TenantId. ABP sets TenantId from the current tenant when the entity object is created, and does not check it on save; its docs say changing it moves the entity to that tenant, and advise setting it only in the entity’s constructor',
      'Throws before anything is written. Updates and deletes also match the stored tenant in the database, so one aimed at another tenant’s row changes nothing and throws',
    ],
  },
  {
    label: 'Tenant key type',
    cells: ['Yours', 'string', 'Guid', 'Any IEquatable and IParsable type: Guid, int, string and others'],
    fullOnly: true,
  },
  {
    label: 'DbContext pooling with a database per tenant',
    cells: [
      'You write it',
      'Not documented; an open issue (#375) has the maintainer recommending against AddDbContextPool',
      'Not documented',
      'Yes: AddDbContextPerTenantDatabase with pooled: true, which checks before each connection and command that the tenant has not changed',
    ],
    fullOnly: true,
  },
  {
    label: 'Checks at build time',
    cells: [
      'None, unless you write analyzers',
      'None: its packages have no analyzers',
      'None: its EF Core package has no analyzers',
      // Core 0.8.0 adds TNY1004. Kept behind the gate: a withdrawn release leaves the site (README, Docs pipeline).
      `Analyzers ${publishedSince('core', 'v0.8.0') ? 'TNY1001 to TNY1004' : 'TNY1001 to TNY1003'}, TNY2001, TNY3001 and TNY3002`,
    ],
    fullOnly: true,
  },
  {
    label: 'Create and migrate tenant databases',
    cells: [
      'You write it',
      'No',
      'ABP provides a base class for a handler you write that migrates a tenant’s database when the tenant is created; managing tenants’ connection strings from a UI needs the commercial SaaS module',
      'Yes, in Pro',
    ],
  },
  {
    label: 'Per-tenant options and authentication',
    cells: ['You write it', 'Yes, both', 'Per-tenant settings and features', 'Yes, both'],
  },
  {
    label: 'Built-in tenant stores',
    cells: [
      'Yours',
      'In-memory, configuration, EF Core, distributed cache, HTTP remote and echo',
      'Configuration, and a database store with a management UI in the Tenant Management module',
      'In-memory only; any other store is an ITenantStore you write',
    ],
    fullOnly: true,
  },
  {
    label: 'Licence',
    cells: [
      'Yours',
      <>
        Apache-2.0. Its{' '}
        <a
          href={'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/README.md#open-source-maintenance-fee'}
          target={'_blank'}
          rel={'noopener noreferrer'}
          className={'text-link hover:underline'}
        >
          README
        </a>{' '}
        says that from 10 November 2026, use of its official releases in revenue-generating work falls under an Open
        Source Maintenance Fee.
      </>,
      'LGPL-3.0; the SaaS module needs a commercial ABP licence (Team or higher)',
      <>
        Core Apache-2.0, free for commercial use; Pro a{' '}
        <Link href={'/pro#pricing'} className={'text-link hover:underline'}>
          subscription
        </Link>
      </>,
    ],
  },
];

// The documents the Finbuckle.MultiTenant and ABP cells, and the notes on /compare, are taken from.
const SOURCES: { project: string; links: { label: string; href: string }[] }[] = [
  {
    project: 'Finbuckle.MultiTenant',
    links: [
      { label: 'EF Core', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/docs/EFCore.md' },
      { label: 'Stores', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/docs/Stores.md' },
      {
        label: 'Strategies',
        href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/docs/Strategies.md',
      },
      { label: 'Options', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/docs/Options.md' },
      {
        label: 'Authentication',
        href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/docs/Authentication.md',
      },
      {
        label: 'TenantInfo',
        href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/src/Finbuckle.MultiTenant.Abstractions/TenantInfo.cs',
      },
      { label: 'README', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/v10.1.4/README.md' },
      { label: 'Issue #375', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/issues/375' },
      { label: 'NuGet', href: 'https://www.nuget.org/packages/Finbuckle.MultiTenant.EntityFrameworkCore' },
    ],
  },
  {
    project: 'ABP',
    links: [
      { label: 'Multi-tenancy', href: 'https://abp.io/docs/latest/framework/architecture/multi-tenancy' },
      { label: 'EF Core', href: 'https://abp.io/docs/latest/framework/data/entity-framework-core' },
      { label: 'SaaS module', href: 'https://abp.io/docs/latest/modules/saas' },
      { label: 'Tenant Management module', href: 'https://abp.io/docs/latest/modules/tenant-management' },
      { label: 'Settings', href: 'https://abp.io/docs/latest/framework/infrastructure/settings' },
      { label: 'Features', href: 'https://abp.io/docs/latest/framework/infrastructure/features' },
      { label: 'NuGet', href: 'https://www.nuget.org/packages/Volo.Abp.EntityFrameworkCore' },
    ],
  },
];

/**
 * Tenantry beside its alternatives, in the facts each project documents, with links to those documents. The home page
 * shows the main rows; /compare passes `full` for every row.
 */
export function ComparisonTable({ full = false }: Readonly<{ full?: boolean }>) {
  const rows = full ? ROWS : ROWS.filter((row) => !row.fullOnly);

  return (
    <div>
      <div className={'overflow-x-auto rounded-xl border border-border bg-card'}>
        <table className={'w-full min-w-[720px] text-left text-sm'}>
          <thead>
            <tr className={'border-b border-border'}>
              <th className={'p-4'} />
              {PROJECTS.map((project) => (
                <th
                  key={project}
                  scope={'col'}
                  className={project === 'Tenantry' ? 'p-4 font-semibold text-link' : 'p-4 font-semibold'}
                >
                  {project}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={'border-b border-border last:border-0 align-top'}>
                <th scope={'row'} className={'p-4 font-medium'}>
                  {row.label}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={PROJECTS[index]} className={'p-4 text-muted-foreground'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={'mt-4 flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground'}>
        {SOURCES.map((source) => (
          <p key={source.project}>
            Sources for {source.project}:{' '}
            {source.links.map((link, index) => (
              <span key={link.href}>
                {index > 0 && ', '}
                <a
                  href={link.href}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                  className={'text-link hover:underline'}
                >
                  {link.label}
                </a>
              </span>
            ))}
            .
          </p>
        ))}
      </div>
    </div>
  );
}
