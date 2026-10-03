import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { Button } from '@/components/ui/button';
import { CodeFigure } from '@/components/shared/code-figure';
import { TrackedLink } from '@/components/shared/tracked-link';
import { ProOffer } from '@/constants/pro-offer';

export const metadata: Metadata = {
  title: 'Tenantry Pro — provisioning, tenant migrations and tenant-aware operations',
  description:
    'Tenantry Pro adds tenant provisioning, EF Core migrations across every tenant database or schema, schema per tenant, the tenant in Hangfire, MassTransit, Quartz.NET and Rebus, audit logging, health checks and metrics.',
  alternates: { canonical: '/pro' },
};

// From Tenantry Pro's guides (tenant lifecycle, migrations, Hangfire), shortened; each compiles against Pro 0.5.
const WORKFLOWS = [
  {
    title: 'Onboard a tenant',
    text: 'One call creates the tenant’s database or schema, migrates it and runs your seeders. The result reports each step, and every built-in step is safe to repeat, so you retry a failed onboarding by running it again.',
    caption: 'TenantOnboarding.cs',
    code: `tenant.UsePro(pro => pro
    .AddSeeder<DefaultDataSeeder>()               // your seeder, last
    .AddDatabaseProvisioning<AppDbContext>()      // creates the database, first
    .AddMigrations<AppDbContext>());              // then migrates it

var result = await provisioner.ProvisionAsync(descriptor, ct);
if (result.Succeeded)
    await tenants.ActivateAsync(descriptor.TenantId, ct);`,
    link: { label: 'Tenant lifecycle', href: '/docs/pro/tenant-lifecycle' },
  },
  {
    title: 'Keep every tenant database migrated',
    text: 'Run migrate-tenants as a deployment step. It applies pending migrations to every tenant database or schema. One failure doesn’t stop the rest, and the step exits non-zero so the release waits. You can also read where each database stands without migrating.',
    caption: 'Program.cs',
    code: `await using var app = builder.Build();

// dotnet run -- migrate-tenants
if (await app.RunTenantMigrationsIfRequestedAsync(args) is { } exitCode)
    return exitCode;   // 1 if any database or schema failed

await app.RunAsync();
return 0;`,
    link: { label: 'Tenant migrations', href: '/docs/pro/migration-orchestration' },
  },
  {
    title: 'Run background work as the tenant',
    text: 'Hangfire and Quartz.NET jobs and MassTransit and Rebus messages run as the tenant they were created for, with the DbContext isolated as in a request. Recurring work can run once per tenant. By default, a job whose tenant no longer exists is rejected.',
    caption: 'Program.cs',
    code: `tenant.UsePro(pro => pro.AddHangfirePropagation());

builder.Services.AddHangfire((sp, config) => config
    .UseSqlServerStorage(connectionString)
    .UseTenantry(sp));

// Runs as the current tenant, or as the one you name:
jobs.ForTenant(tenantId).Enqueue<ReportJob>(job => job.Execute());`,
    link: { label: 'Background jobs', href: '/docs/pro/background-jobs' },
  },
];

const ALSO = [
  {
    title: 'Schema per tenant and mixed mode',
    text: 'A schema per tenant on SQL Server and PostgreSQL, or per tenant a choice of its own database, its own schema or the shared database.',
    href: '/docs/pro/schema-per-tenant',
  },
  {
    title: 'Audit logging',
    text: 'Every insert, update and delete your contexts save, with the tenant, the time, who made it and the changed values: once committed, or in the same transaction.',
    href: '/docs/pro/audit-logging',
  },
  {
    title: 'Health checks and metrics',
    text: 'Health checks that probe every tenant database for its connection and pending migrations, and ASP.NET Core’s request metrics tagged with the tenant.',
    href: '/docs/pro/health-checks',
  },
  {
    title: 'Connection-string caching',
    text: 'Connection strings read from a secrets store, kept for a period, so the lookup runs once per tenant rather than for every context.',
    href: '/docs/pro/database-per-tenant',
  },
];

const QUESTIONS = [
  {
    question: 'What does the subscription include?',
    answer:
      'Every Tenantry Pro package from a private NuGet feed, each release while you subscribe, a licence key and email support. One price for your whole company, billed monthly or yearly.',
  },
  {
    question: 'How does my team install it?',
    answer:
      'A subscription gives one GitHub account access to the feed. Connect an account your team controls, such as a machine account, create a read-only token from it, and share the token with your developers and CI as a secret. A classic token reads every package its account can see, which is another reason to use a machine account. Everyone in your company may use Pro.',
    link: { label: 'Installation', href: '/docs/pro/installation' },
  },
  {
    question: 'How do I install it, locally and in CI?',
    answer:
      'Connect GitHub on your Pro access page, then add the feed to your nuget.config with a read-only token. The guide covers CI and Docker builds.',
    link: { label: 'Installation', href: '/docs/pro/installation' },
  },
  {
    question: 'Which versions and databases?',
    answer:
      '.NET 8, 9 and 10, with the EF Core of each. Provisioning and migrations on SQL Server, PostgreSQL and MySQL; schema per tenant on SQL Server and PostgreSQL.',
    link: { label: 'Compatibility', href: '/docs/pro/compatibility' },
  },
  {
    question: 'What does the beta mean?',
    answer:
      "Tenantry Core and Pro are in beta until 1.0, which comes no earlier than 10 November 2027. Releases are numbered 0.x, and a minor release (0.5 to 0.6) can change the API, with the steps to update in its release notes. Pro releases each minor version with Core's.",
    link: { label: 'Compatibility', href: '/docs/pro/compatibility' },
  },
  {
    question: 'Does it phone home?',
    answer: 'No. The licence key is checked offline when the application starts, and it does not expire.',
    link: { label: 'Licensing', href: '/docs/pro/licensing' },
  },
  {
    question: 'What happens when the subscription ends?',
    answer:
      'The versions you have keep working, under the licence: the key keeps validating. Your access to the package feed ends, so keep copies of the packages you build with, in an internal feed or a local package folder, until you subscribe again.',
  },
];

export default function ProPage() {
  return (
    <>
      <Header />
      <main>
        <section className={'border-b border-border/70'}>
          <div className={'mx-auto max-w-6xl px-4 pb-16 pt-16 md:px-8 md:pt-24'}>
            <h1 className={'text-4xl font-bold tracking-tight text-balance sm:text-5xl'}>Tenantry Pro</h1>
            <p className={'mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground'}>
              {ProOffer.description} Pro builds on the open-source Tenantry Core, which stays free and covers resolving
              tenants and isolating their data on its own.
            </p>
            <div className={'mt-8 flex flex-wrap items-center gap-3'}>
              <Button asChild size={'lg'}>
                <TrackedLink href={'/#pricing'} event={'See pricing'} data={{ from: 'pro' }}>
                  See pricing <ArrowRight className={'h-4 w-4'} />
                </TrackedLink>
              </Button>
              <Button asChild size={'lg'} variant={'outline'}>
                <Link href={'/docs/pro'}>Pro docs</Link>
              </Button>
            </div>
          </div>
        </section>

        {WORKFLOWS.map((workflow, index) => (
          <section key={workflow.title} className={index > 0 ? 'border-t border-border/70' : undefined}>
            <div
              className={
                'mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:px-8 md:py-20 lg:grid-cols-[0.9fr_1.1fr]'
              }
            >
              <div>
                <h2 className={'text-2xl font-bold tracking-tight md:text-3xl'}>{workflow.title}</h2>
                <p className={'mt-4 leading-relaxed text-muted-foreground'}>{workflow.text}</p>
                <Link
                  href={workflow.link.href}
                  className={'mt-6 inline-flex items-center gap-1 text-sm font-medium text-link hover:underline'}
                >
                  {workflow.link.label} <ArrowRight className={'h-3.5 w-3.5'} />
                </Link>
              </div>
              <CodeFigure code={workflow.code} caption={workflow.caption} />
            </div>
          </section>
        ))}

        <section className={'border-t border-border/70 bg-surface'}>
          <div className={'mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20'}>
            <h2 className={'text-2xl font-bold tracking-tight md:text-3xl'}>Also in Pro</h2>
            <div className={'mt-8 grid gap-6 sm:grid-cols-2'}>
              {ALSO.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className={'rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40'}
                >
                  <h3 className={'font-semibold'}>{item.title}</h3>
                  <p className={'mt-2 text-sm leading-relaxed text-muted-foreground'}>{item.text}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={'border-t border-border/70'}>
          <div className={'mx-auto max-w-3xl px-4 py-16 md:px-8 md:py-20'}>
            <h2 className={'text-2xl font-bold tracking-tight md:text-3xl'}>Before you buy</h2>
            <dl className={'mt-8 flex flex-col gap-8'}>
              {QUESTIONS.map((item) => (
                <div key={item.question}>
                  <dt className={'font-semibold'}>{item.question}</dt>
                  <dd className={'mt-2 leading-relaxed text-muted-foreground'}>
                    {item.answer}{' '}
                    {item.link && (
                      <TrackedLink
                        href={item.link.href}
                        event={'Pro question link'}
                        data={{ to: item.link.href }}
                        className={'text-link hover:underline'}
                      >
                        {item.link.label}
                      </TrackedLink>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className={'mt-12'}>
              <Button asChild size={'lg'}>
                <TrackedLink href={'/#pricing'} event={'See pricing'} data={{ from: 'pro, questions' }}>
                  See pricing <ArrowRight className={'h-4 w-4'} />
                </TrackedLink>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
