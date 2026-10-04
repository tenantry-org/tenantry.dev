import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { ComparisonTable } from '@/components/home/comparison/comparison';

export const metadata: Metadata = {
  title: 'Tenantry compared with Finbuckle.MultiTenant, ABP and your own query filters',
  description:
    'How Tenantry differs from Finbuckle.MultiTenant, ABP and hand-written EF Core query filters, including what Tenantry does not do.',
  alternates: { canonical: '/compare' },
};

// The details behind the table. Finbuckle.MultiTenant and ABP facts come from the documents the table links.
const NOTES = [
  {
    title: 'Writes',
    text: 'Tenantry filters ExecuteUpdate and ExecuteDelete to the current tenant, and an ExecuteUpdate cannot set TenantId. With no current tenant, its filter matches nothing and, by default, writes to tenant-owned entities are rejected.',
  },
  {
    title: 'A database per tenant',
    text: 'Tenantry Core connects each tenant’s context to its own database, pooled contexts included (AddDbContextPerTenantDatabase with pooled: true): a pooled context reads the tenant each time it is used. Finbuckle’s docs recommend setting a context’s tenant when it is created and not changing it. ABP’s SaaS module and Tenantry Pro create and migrate tenant databases.',
  },
  {
    title: 'Options and authentication',
    text: 'Tenantry.Options gives each tenant its own option values, named options included, so an authentication scheme can use a tenant’s own settings. app.UseTenantResolution() makes the tenant current before authentication, and tenants on different identity providers get a scheme each. ASP.NET Core Identity works with its own IdentityDbContext and a user type that implements ITenantEntity.',
  },
  {
    title: 'What Tenantry does not do',
    text: 'Tenantry is a library, not an application framework: there is no tenant management UI, as ABP’s Tenant Management module has. It builds in one tenant store, which holds tenants in memory. It adds TenantId to no key or index, where Finbuckle’s AdjustUniqueIndexes() does, so declare per-tenant unique indexes yourself. When a resolver’s identifier names no tenant, Tenantry does not try the next resolver, as Finbuckle does. The isolation is in EF Core, not the database: raw SQL and IgnoreQueryFilters() are not isolated.',
  },
  {
    title: '.NET versions',
    text: 'Finbuckle.MultiTenant’s major versions follow .NET’s, and version 10 targets .NET 10 only. Tenantry supports .NET 10, and .NET 8 and 9 until November 2027.',
  },
];

export default function ComparePage() {
  return (
    <>
      <Header />
      <main className={'mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24'}>
        <h1 className={'text-4xl font-bold tracking-tight text-balance sm:text-5xl'}>How Tenantry compares</h1>
        <p className={'mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground'}>
          Tenantry beside the options most .NET teams weigh, as each project documents itself.
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
          Checked in October 2026 against each project’s documentation. Something out of date? Email{' '}
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
