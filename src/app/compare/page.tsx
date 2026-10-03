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

// The details behind the table, each checked against the project's own docs (comparison.tsx says when).
const NOTES = [
  {
    title: 'Writes',
    text: 'Finbuckle checks the entities EF Core tracks before saving, and by default throws when one belongs to another tenant. Tenantry rejects those writes too, and also puts the stored tenant in every UPDATE and DELETE, so a forged key changes no rows. ExecuteUpdate and ExecuteDelete are filtered to the current tenant, and cannot set TenantId.',
  },
  {
    title: 'No tenant',
    text: 'With no current tenant, Tenantry’s filter matches nothing and tenant-scoped writes are rejected. Finbuckle throws when a multi-tenant entity is saved with no tenant.',
  },
  {
    title: 'A database per tenant',
    text: 'Tenantry supports a database per tenant with pooled contexts (AddDbContextPool, AddPooledDbContextFactory). Finbuckle’s docs do not cover pooling. ABP’s SaaS module, and Tenantry Pro, create and migrate tenant databases; Finbuckle leaves that to you.',
  },
  {
    title: 'What Tenantry does not do',
    text: 'Core 0.5 has no per-tenant options. The next Core release adds them: IOptions, IOptionsSnapshot and IOptionsMonitor give the current tenant’s value for the options types you name. It does not cover named options, so authentication schemes, which Finbuckle configures per tenant, stay the same for every tenant. Tenantry is a library, not an application framework: there is no admin UI or tenant management screen, as ABP has.',
  },
  {
    title: '.NET versions',
    text: 'Finbuckle.MultiTenant 10 targets .NET 10 only. Tenantry supports .NET 10, and .NET 8 and 9 until November 2027.',
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
          <ComparisonTable />
        </div>
        <dl className={'mt-12 flex max-w-3xl flex-col gap-8'}>
          {NOTES.map((note) => (
            <div key={note.title}>
              <dt className={'font-semibold'}>{note.title}</dt>
              <dd className={'mt-2 leading-relaxed text-muted-foreground'}>{note.text}</dd>
            </div>
          ))}
        </dl>
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
