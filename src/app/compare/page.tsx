import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { ComparisonTable } from '@/components/home/comparison/comparison';
import { DOTNET_SUPPORT } from '@/constants/dotnet-support';
import { latestDocsVersion } from '@/lib/docs-versions';

export const metadata: Metadata = {
  title: 'Tenantry compared with Finbuckle.MultiTenant and ABP',
  description:
    'Tenantry as an alternative to Finbuckle.MultiTenant, ABP and hand-written EF Core query filters: how they differ, and what Tenantry does not do.',
  alternates: { canonical: '/compare' },
};

// The details behind the table. Finbuckle.MultiTenant and ABP facts come from the documents the table links, and from
// their source at the versions named at the end of the page.
const NOTES: { title: string; text: string | string[] }[] = [
  {
    title: 'Writes',
    text: 'Tenantry filters ExecuteUpdate and ExecuteDelete to the current tenant, and an ExecuteUpdate cannot set TenantId. With no current tenant, its filter matches nothing and, by default, writes to tenant-owned entities are rejected.',
  },
  {
    title: 'A database per tenant',
    text: [
      'Tenantry Core’s AddDbContextPerTenantDatabase, pooled or not, connects each context, or each pool lease, to the database of the tenant current when it is created. Before every connection EF Core opens and every command it runs, it checks that the same tenant is still current, and throws if not. Tenantry Pro creates and migrates tenant databases.',
      'Finbuckle.MultiTenant’s docs have the context read the tenant’s connection string in OnConfiguring, with the tenant taken in its constructor and the context registered with AddDbContext; the context keeps that database. It documents no pooled path, and an open issue (#375) has the maintainer recommending against AddDbContextPool. Its EF Core package does not check, when a connection opens or a command runs, that the context’s database belongs to the tenant current then.',
      'ABP registers contexts with AddAbpDbContext and, in a unit of work, resolves the current tenant’s connection string each time a context is requested. Its EF Core integration does not check, when a connection opens or a command runs, that the context’s database belongs to the tenant current then. ABP provides a base class for a handler you write that migrates a tenant’s database when the tenant is created; managing tenants’ connection strings from a UI needs the commercial SaaS module.',
    ],
  },
  {
    title: 'Options and authentication',
    text: 'Tenantry.Options gives each tenant its own option values, named options included, so an authentication scheme can use a tenant’s own settings. app.UseTenantResolution() makes the tenant current before authentication, and tenants on different identity providers get a scheme each. ASP.NET Core Identity works with its own IdentityDbContext and a user type that implements ITenantEntity.',
  },
  {
    title: 'What Tenantry does not do',
    text: 'Tenantry is a library, not an application framework: there is no tenant management UI, as ABP’s Tenant Management module has. It builds in one tenant store, which holds tenants in memory. It adds TenantId to no key or index, where Finbuckle can, with AdjustUniqueIndexes(), so declare per-tenant unique indexes yourself. When a resolver’s identifier names no tenant, Tenantry does not try the next resolver, as Finbuckle does. The isolation is in EF Core, not the database: FromSql on a tenant entity is filtered like any other query on it; SQL sent with SqlQuery or ExecuteSql, and queries with IgnoreQueryFilters(), are not isolated.',
  },
  {
    title: 'Versions',
    text: `Tenantry is in beta: its releases are numbered 0.x, the newest is ${latestDocsVersion.version}, and 1.0 comes no earlier than 10 November 2027. From version 10, Finbuckle.MultiTenant’s major versions follow .NET’s, and version 10 targets .NET 10 only; its 9.x and 8.x lines still get fixes (9.4.13 and 8.1.18 in September 2026). Tenantry supports ${DOTNET_SUPPORT}.`,
  },
];

export default function ComparePage() {
  return (
    <>
      <Header />
      <main className={'mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24'}>
        <h1 className={'text-4xl font-bold tracking-tight text-balance sm:text-5xl'}>How Tenantry compares</h1>
        <p className={'mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground'}>
          Tenantry beside three alternatives: your own query filters, Finbuckle.MultiTenant and ABP.
        </p>
        <p className={'mt-4 max-w-3xl leading-relaxed text-muted-foreground'}>
          Tenantry fits an existing ASP.NET Core and EF Core application that keeps its own DbContext and tenant store:
          it is a library with no tenant management UI, and its only built-in store holds tenants in memory. ABP fits an
          application built on ABP, whose contexts derive from AbpDbContext and whose Tenant Management module has a UI
          for tenants. Finbuckle.MultiTenant builds in more tenant stores, such as EF Core and a distributed cache, and
          can add TenantId to unique indexes with AdjustUniqueIndexes(). Your own query filters need a filter on each
          entity and a SaveChanges override.
        </p>
        <div className={'mt-10'}>
          <ComparisonTable full={true} />
        </div>
        <dl className={'mt-12 flex max-w-3xl flex-col gap-8'}>
          {NOTES.map((note) => (
            <div key={note.title}>
              <dt className={'font-semibold'}>{note.title}</dt>
              <dd className={'mt-2 flex flex-col gap-3 leading-relaxed text-muted-foreground'}>
                {[note.text].flat().map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className={'mt-12 max-w-3xl leading-relaxed text-muted-foreground'}>
          The{' '}
          <Link href={'/docs/core/migrating-from-finbuckle'} className={'text-link hover:underline'}>
            migration guide
          </Link>{' '}
          takes a Finbuckle.MultiTenant application to Tenantry step by step.
        </p>
        <p className={'mt-12 text-sm text-muted-foreground'}>
          Checked in October 2026 against Finbuckle.MultiTenant 10.1.4 and ABP 10.6.1, their documentation and source.
          To report something out of date, email{' '}
          <Link href={'mailto:support@tenantry.dev'} className={'text-link hover:underline'}>
            support@tenantry.dev
          </Link>
          .
        </p>
      </main>
      <Footer />
    </>
  );
}
