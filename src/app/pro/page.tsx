import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { Pricing } from '@/components/home/pricing/pricing';
import { Button } from '@/components/ui/button';
import { CodeFigure } from '@/components/shared/code-figure';
import { ProofStrip } from '@/components/shared/proof-strip';
import { TrackedLink } from '@/components/shared/tracked-link';
import { DOTNET_SUPPORT } from '@/constants/dotnet-support';
import { SUPPORT_REPLY_WITHIN } from '@/constants/pro-offer';
import { latestDocsVersion, publishedSince } from '@/lib/docs-versions';

export const metadata: Metadata = {
  title: 'Tenantry Pro: multi-tenant migrations, provisioning and jobs',
  description:
    'For multi-tenant .NET apps: migrate and provision tenant databases or schemas, run jobs and messages as their tenant, audit changes and offboard tenants.',
  alternates: { canonical: '/pro' },
};

// Pro 0.8 replaces seeders with provisioning steps of your own (ITenantProvisioningStep<TKey>, AddProvisioningStep).
const YOUR_STEP = publishedSince('pro', 'v0.8.0')
  ? '.AddProvisioningStep<SeedInitialData>()       // your step, last'
  : '.AddSeeder<DefaultDataSeeder>()               // your seeder, last';

// From Tenantry Pro's guides (tenant migrations, tenant lifecycle, Hangfire, audit logging), shortened to the outcome,
// an example and a limitation; each sample uses the API of the Pro release the site shows.
const WORKFLOWS = [
  {
    title: 'Keep every tenant database migrated',
    text: 'Run migrate-tenants as a deployment step to apply pending migrations to every tenant database or schema. It tries every one, unless --max-failures or a stop signal ends the run early, and exits non-zero if any failed, which stops the release. Run one at a time: two runs from overlapping deployments race.',
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
    title: 'Onboard and offboard tenants',
    text: 'One call creates a tenant’s database or schema, migrates it and runs your own steps, such as seeding its data. Offboarding refuses a tenant that is still active, runs your export steps, then drops the database or schema, or deletes the tenant’s rows from a shared database’s tenant-owned tables in one transaction per context. A failed run is retried by running it again, so your steps must be safe to repeat.',
    caption: 'TenantOnboarding.cs',
    code: `tenant.UsePro(pro => pro
    ${YOUR_STEP}
    .AddDatabaseProvisioning<AppDbContext>()      // creates the database, first
    .AddMigrations<AppDbContext>());              // then migrates it

var result = await provisioner.ProvisionAsync(descriptor, ct);
if (result.Succeeded)
    await tenants.ActivateAsync(descriptor.TenantId, ct);`,
    link: { label: 'Tenant lifecycle', href: '/docs/pro/tenant-lifecycle' },
  },
  {
    title: 'Run background work as the tenant',
    text: 'Hangfire and Quartz.NET jobs and MassTransit and Rebus messages run as the tenant they were created for, with the DbContext isolated as in a request, and recurring jobs can run once for each tenant. By default, work whose tenant no longer exists or is suspended fails without running. Work created with no tenant current carries none, and by default runs without one and logs a warning.',
    caption: 'Program.cs',
    code: `tenant.UsePro(pro => pro.AddHangfirePropagation());

builder.Services.AddHangfire((sp, config) => config
    .UseSqlServerStorage(connectionString)
    .UseTenantry(sp));

// Runs as the current tenant, or as the one you name:
jobs.WithTenant(tenantId).Enqueue<ReportJob>(job => job.Execute());`,
    link: { label: 'Background jobs', href: '/docs/pro/background-jobs' },
  },
  {
    title: 'Audit each tenant’s changes',
    text: 'Pro records each insert, update and delete that SaveChanges writes through a context with UseTenantry(), with the tenant, the table and primary key, the old and new values and the time. Your IAuditContextProvider names the user and your IAuditStore keeps the entries; by default they go to the log. ExecuteUpdate, ExecuteDelete and raw SQL are not recorded.',
    caption: 'Program.cs',
    code: `tenant.UsePro(pro => pro.AddAuditLogging(opts =>
    opts.ExcludeProperty<User>(user => user.PasswordHash)));

builder.Services.AddSingleton<IAuditContextProvider, HttpAuditContextProvider>();   // who made the change
builder.Services.AddScoped<IAuditStore, AuditTableStore>();                         // where entries go`,
    link: { label: 'Audit logging', href: '/docs/pro/audit-logging' },
  },
];

const ALSO = [
  {
    title: 'Schema per tenant and mixed mode',
    text: 'A schema per tenant on SQL Server and PostgreSQL, or per tenant a choice of its own database, its own schema or the shared database.',
    href: '/docs/pro/schema-per-tenant',
  },
  {
    title: 'Health checks',
    text: 'Health checks that probe every tenant database for its connection and pending migrations.',
    href: '/docs/pro/health-checks',
  },
  {
    title: 'Connection-string caching',
    text: 'Connection strings read from a secrets store, kept for a period, so the lookup runs once per tenant rather than for every context.',
    href: '/docs/pro/database-per-tenant',
  },
];

// The minor after the newest, for the example of a minor release: 0.6 → 0.7.
const [major, minor] = latestDocsVersion.version.split('.').map(Number);
const nextMinor = `${major}.${minor + 1}`;

const QUESTIONS = [
  {
    question: 'What does the subscription include?',
    answer: `Every Tenantry Pro package from a private NuGet feed, each release while you subscribe, a licence key and email support, with a reply within ${SUPPORT_REPLY_WITHIN}. One price for your whole company, billed monthly or yearly.`,
  },
  {
    question: 'How does my team install it, locally and in CI?',
    answer:
      'A subscription gives one GitHub account access to the feed. On your Pro access page, connect an account your team controls, such as a machine account, and create a read-only token from it. Add the feed to your nuget.config with that token, and share the token with your developers and CI as a secret. A classic token reads every package its account can see, which is another reason to use a machine account. Everyone in your company may use Pro. The guide covers CI and Docker builds.',
    link: { label: 'Installation', href: '/docs/pro/installation' },
  },
  {
    question: 'Will the package feed change?',
    answer:
      'Yes, before Tenantry Pro goes on sale. The packages are on GitHub Packages today, the feed the subscription system has been built and tested with, so the docs describe it. A private Tenantry feed will replace it, and after a subscription ends it will still let you restore the versions released while you subscribed.',
  },
  {
    question: 'Which versions and databases?',
    answer: `${DOTNET_SUPPORT}, each with its own EF Core version. Provisioning and migrations on SQL Server, PostgreSQL and MySQL; schema per tenant on SQL Server and PostgreSQL.`,
    link: { label: 'Compatibility', href: '/docs/pro/compatibility' },
  },
  {
    question: 'Is it production-ready?',
    answer: `Tenantry Core and Pro are in beta until 1.0, which comes no earlier than 10 November 2027. The isolation is tested on every build against SQL Server, PostgreSQL, MySQL and SQLite. Releases are numbered 0.x, and a minor release (${latestDocsVersion.version} to ${nextMinor}) can change the API, with the steps to update in its release notes. Pro releases each minor version with Core's.`,
    link: { label: 'Compatibility', href: '/docs/pro/compatibility' },
  },
  {
    question: 'Can I ship Pro inside software my customers install?',
    answer:
      'Yes, as part of your application, including one your customers install or host themselves. They may not use Pro on its own.',
    link: { label: 'EULA', href: '/legal/eula' },
  },
  {
    question: 'Does it phone home?',
    answer: 'No. The licence key is checked offline when the application starts, and it does not expire.',
    link: { label: 'Licensing', href: '/docs/pro/licensing' },
  },
  {
    question: 'What happens when the subscription ends?',
    answer:
      'The versions you have keep working, and the key keeps validating. Access to the package feed ends, so keep copies of the packages you build with. Each Pro version runs on one Core minor version (Pro 0.6 on Core 0.6.x), so you can take Core patch releases but not the next Core minor until you subscribe again. Code that uses only Core can move to any Core version. Security fixes are released as a patch to every affected minor version. Restoring them from today’s GitHub feed needs an active subscription, so after it ends, email support@tenantry.dev for the latest patch of any minor version released while you subscribed. The private feed that replaces it will let you restore those yourself.',
    link: { label: 'Compatibility', href: '/docs/pro/compatibility#tenantry-core' },
  },
  {
    question: 'What if Tenantry stops?',
    answer:
      'Core stays Apache-2.0 on GitHub, and the Pro versions you have stay licensed and keep working, as when a subscription ends.',
    link: { label: 'EULA', href: '/legal/eula' },
  },
];

export default function ProPage() {
  return (
    <>
      <Header />
      <main>
        <section className={'border-b border-border/70'}>
          <div className={'mx-auto max-w-6xl px-4 pb-16 pt-16 md:px-8 md:pt-24'}>
            <p className={'text-sm font-medium text-link'}>Tenantry Pro</p>
            <h1 className={'mt-3 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl'}>
              Provision, migrate and remove tenants, run jobs as their tenant, and audit their changes
            </h1>
            <p className={'mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground'}>
              Pro builds on the free, open-source Tenantry Core. With a database or schema per tenant, it creates them,
              migrates them all as a deployment step, and checks their health. With any layout, a shared database
              included, it runs Hangfire, Quartz.NET, MassTransit and Rebus work as its tenant, keeps an audit log of
              each tenant’s changes, and offboards a tenant by deleting its rows or dropping its database or schema. One
              price covers your whole company.
            </p>
            <div className={'mt-8 flex flex-wrap items-center gap-3'}>
              <Button asChild size={'lg'}>
                <TrackedLink href={'#pricing'} event={'See pricing'} data={{ from: 'pro' }}>
                  Subscribe to Pro <ArrowRight className={'h-4 w-4'} />
                </TrackedLink>
              </Button>
              <Button asChild size={'lg'} variant={'outline'}>
                <Link href={'/docs/pro'}>Pro docs</Link>
              </Button>
            </div>
            <p className={'mt-10 max-w-2xl rounded-xl border border-border bg-card p-5 text-sm leading-relaxed'}>
              <span className={'font-semibold'}>Do I need Pro?</span>{' '}
              <span className={'text-muted-foreground'}>
                Core isolates tenant data, connects each tenant to a database of its own if you want one, and runs your
                own background work as a tenant with ITenantScopeFactory. With a shared database or a database per
                tenant, everything that keeps one tenant’s data from another’s is in Core; Pro adds a schema per tenant
                and mixed mode, with the checks those layouts need, and the operations around tenants. If Core covers
                your application, it is all you need.
              </span>
            </p>
          </div>
        </section>

        <ProofStrip samples={'all'} />

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
            <div className={'mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3'}>
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
          </div>
        </section>

        <Pricing proLink={false} />
      </main>
      <Footer />
    </>
  );
}
