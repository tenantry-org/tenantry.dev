import type { ReactNode } from 'react';

// Checked in October 2026 against the documents in SOURCES (Finbuckle.MultiTenant 10, ABP's latest docs) and against
// Tenantry Core 0.6 and Pro 0.6. Check them again when any of them releases a major version. A row whose Finbuckle or
// ABP cell the sources do not support is left out, not filled in.
const PROJECTS = ['Your own query filters', 'Finbuckle.MultiTenant', 'ABP', 'Tenantry'] as const;

const ROWS: { label: string; cells: [ReactNode, ReactNode, ReactNode, ReactNode]; fullOnly?: boolean }[] = [
  {
    label: 'What your DbContext needs',
    cells: [
      'A filter on each entity, and a SaveChanges override',
      'Derive from MultiTenantDbContext, or implement IMultiTenantDbContext and call EnforceMultiTenant() in SaveChanges',
      'Derive from AbpDbContext, in an ABP application',
      'One call, options.UseTenantry()',
    ],
  },
  {
    label: 'Saving an entity with another tenant’s TenantId',
    cells: [
      'Whatever your SaveChanges override checks',
      'Throws by default; TenantMismatchMode can ignore or overwrite it instead',
      'Not documented; its docs advise setting TenantId only in the entity’s constructor',
      'Throws, and the stored TenantId is in every UPDATE and DELETE, so a forged key matches no row',
    ],
  },
  {
    label: 'Tenant key type',
    cells: ['Yours', 'string', 'Guid', 'Any IEquatable and IParsable type: Guid, int, string and others'],
    fullOnly: true,
  },
  {
    label: 'Create and migrate tenant databases',
    cells: [
      'You write it',
      'No',
      'A framework event handler, if the application configures it, migrates a new tenant’s database; managing tenants’ connection strings needs the commercial SaaS module',
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
          href={'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/README.md#open-source-maintenance-fee'}
          target={'_blank'}
          rel={'noopener noreferrer'}
          className={'text-link hover:underline'}
        >
          README
        </a>{' '}
        says that from 10 November, use of its official releases in revenue-generating work falls under an Open Source
        Maintenance Fee.
      </>,
      'A commercial ABP licence for the SaaS module',
      'Core Apache-2.0; Pro a subscription',
    ],
  },
];

// The documents the Finbuckle.MultiTenant and ABP cells, and the notes on /compare, are taken from.
const SOURCES: { project: string; links: { label: string; href: string }[] }[] = [
  {
    project: 'Finbuckle.MultiTenant',
    links: [
      { label: 'EF Core', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/docs/EFCore.md' },
      { label: 'Stores', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/docs/Stores.md' },
      { label: 'Strategies', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/docs/Strategies.md' },
      { label: 'Options', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/docs/Options.md' },
      {
        label: 'Authentication',
        href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/docs/Authentication.md',
      },
      {
        label: 'TenantInfo',
        href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/src/Finbuckle.MultiTenant.Abstractions/TenantInfo.cs',
      },
      { label: 'README', href: 'https://github.com/Finbuckle/Finbuckle.MultiTenant/blob/main/README.md' },
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
    ],
  },
];

/**
 * Tenantry beside the alternatives a .NET team weighs, in the facts each project documents, with links to those
 * documents. The home page shows the main rows; /compare passes `full` for every row.
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
