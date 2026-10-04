import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { ComparisonTable } from '@/components/home/comparison/comparison';
import { DOTNET_SUPPORT } from '@/constants/dotnet-support';

export const metadata: Metadata = {
  title: 'Tenantry compared with Finbuckle.MultiTenant, ABP and your own query filters',
  description:
    'How Tenantry differs from Finbuckle.MultiTenant, ABP and hand-written EF Core query filters, including what Tenantry does not do.',
  alternates: { canonical: '/compare' },
};

// The details behind the table. Finbuckle.MultiTenant and ABP facts come from the documents the table links, and from
// their source at the versions named at the end of the page.
const NOTES = [
  {
    title: 'Writes',
    text: 'Tenantry filters ExecuteUpdate and ExecuteDelete to the current tenant, and an ExecuteUpdate cannot set TenantId. With no current tenant, its filter matches nothing and, by default, writes to tenant-owned entities are rejected.',
  },
  {
    title: 'A database per tenant',
    text: 'Tenantry Core’s AddDbContextPerTenantDatabase, pooled or not, connects each context, or each pool lease, to the database of the tenant current when it is created. Before every connection EF Core opens and every command it runs, it checks that the same tenant is still current, and throws if not. Finbuckle.MultiTenant’s docs have the context read the tenant’s connection string in OnConfiguring, with the tenant taken in its constructor and the context registered with AddDbContext; the context keeps that database. It documents no pooled path, and an open issue (#375) has the maintainer recommending against AddDbContextPool. ABP registers contexts with AddAbpDbContext and, in a unit of work, resolves the current tenant’s connection string each time a context is requested. Neither Finbuckle.MultiTenant’s EF Core package nor ABP’s EF Core integration checks, when a connection opens or a command runs, that the context’s database belongs to the tenant current then. ABP provides a base class for a handler you write that migrates a tenant’s database when the tenant is created; managing tenants’ connection strings from a UI needs the commercial SaaS module. Tenantry Pro creates and migrates tenant databases.',
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
    title: '.NET versions',
    text: `From version 10, Finbuckle.MultiTenant’s major versions follow .NET’s, and version 10 targets .NET 10 only; its 9.x and 8.x lines still get fixes (9.4.13 and 8.1.18 in September 2026). Tenantry supports ${DOTNET_SUPPORT}.`,
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
        <div className={'mt-10'}>
          <ComparisonTable full={true} />
        </div>
        <dl className={'mt-12 flex max-w-3xl flex-col gap-8'}>
          {NOTES.map((note) => (
            <div key={note.title}>
              <dt className={'font-semibold'}>{note.title}</dt>
              <dd className={'mt-2 leading-relaxed text-muted-foreground'}>{note.text}</dd>
            </div>
          ))}
        </dl>
        <p className={'mt-12 max-w-3xl leading-relaxed text-muted-foreground'}>
          Moving from Finbuckle.MultiTenant? The{' '}
          <Link href={'/docs/core/migrating-from-finbuckle'} className={'text-link hover:underline'}>
            migration guide
          </Link>{' '}
          takes a Finbuckle application to Tenantry step by step.
        </p>
        <p className={'mt-12 text-sm text-muted-foreground'}>
          Checked in October 2026 against Finbuckle.MultiTenant 10.1.4 and ABP 10.6.1, their documentation and source.
          Something out of date? Email{' '}
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
