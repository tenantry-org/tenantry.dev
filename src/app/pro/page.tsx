import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { Button } from '@/components/ui/button';
import { CodeFigure } from '@/components/shared/code-figure';
import { TrackedLink } from '@/components/shared/tracked-link';
import { SUPPORT_REPLY_WITHIN } from '@/constants/pro-offer';

export const metadata: Metadata = {
  title: 'Tenantry Pro: the tenant in jobs and messages, audit logging, onboarding and migrations',
  description: `Tenantry Pro runs Hangfire, Quartz.NET, MassTransit and Rebus work as its tenant, records each tenant's changes, onboards and offboards tenants in one call, and migrates every tenant database or schema as a deployment step. For a shared database, a database or schema per tenant, or a mix. One price for your whole company.`,
  alternates: { canonical: '/pro' },
};

// From Tenantry Pro's guides (Hangfire, audit logging, tenant lifecycle, migrations), shortened; each uses Pro 0.6's API.
const WORKFLOWS = [
  {
    title: 'Run background work as the tenant',
    text: 'Hangfire and Quartz.NET jobs and MassTransit and Rebus messages run as the tenant they were created for, with the DbContext isolated as in a request. Recurring jobs and background services can run once for each tenant. By default, work whose tenant no longer exists, or is suspended, fails rather than running without a tenant. An adapter API carries the tenant through other libraries the same way.',
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
    text: 'Pro records each insert, update and delete that SaveChanges writes through a context with UseTenantry(): the tenant, the table and primary key, the old and new values, the time and a correlation id. Your IAuditContextProvider names the user, and your IAuditStore keeps the entries; by default no user is named and the entries go to the log. They are written once the transaction commits, or inside it if you choose. ExecuteUpdate, ExecuteDelete and raw SQL are not recorded.',
    caption: 'Program.cs',
    code: `tenant.UsePro(pro => pro.AddAuditLogging(opts =>
    opts.ExcludeProperty<User>(user => user.PasswordHash)));

builder.Services.AddSingleton<IAuditContextProvider, HttpAuditContextProvider>();   // who made the change
builder.Services.AddScoped<IAuditStore, AuditTableStore>();                         // where entries go`,
    link: { label: 'Audit logging', href: '/docs/pro/audit-logging' },
  },
  {
    title: 'Onboard and offboard tenants',
    text: 'One call onboards a tenant: it creates the tenant’s database or schema and migrates it, if the tenant has one, then runs your seeders, and its result reports each step. With a shared database it runs only your seeders and steps. To retry a failed onboarding, run it again: every step runs again, and Tenantry’s own are safe to repeat, so write your seeders to be too. Offboarding refuses a tenant that is still active and runs your export steps. With the step for it added, it then deletes the tenant’s rows from every tenant-owned table of a shared database in one transaction, or drops its database or schema.',
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
    text: 'Run migrate-tenants as a deployment step. It applies pending migrations to every tenant database or schema. If one fails, the others still run, and the step exits non-zero, which stops the release. You can also read where each database stands without migrating.',
    caption: 'Program.cs',
    code: `await using var app = builder.Build();

// dotnet run -- migrate-tenants
if (await app.RunTenantMigrationsIfRequestedAsync(args) is { } exitCode)
    return exitCode;   // 1 if any database or schema failed

await app.RunAsync();
return 0;`,
    link: { label: 'Tenant migrations', href: '/docs/pro/migration-orchestration' },
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

// What a buyer can check for themselves.
const PROOF = [
  {
    text: 'Core’s isolation tests run on every build against SQL Server, PostgreSQL, MySQL and SQLite',
    href: '/docs/core/compatibility#databases',
  },
  {
    text: '18 runnable samples: 6 for Core, 12 for Pro',
    href: 'https://github.com/tenantry-org/tenantry-pro-docs/tree/master/samples',
  },
  { text: 'Core is Apache-2.0, on GitHub', href: 'https://github.com/tenantry-org/tenantry-core' },
];

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
    answer:
      '.NET 10 with EF Core 10. .NET 8 and 9, with their EF Core, until 10 November 2027, a year after Microsoft’s support ends. Provisioning and migrations on SQL Server, PostgreSQL and MySQL; schema per tenant on SQL Server and PostgreSQL.',
    link: { label: 'Compatibility', href: '/docs/pro/compatibility' },
  },
  {
    question: 'Is it production-ready?',
    answer:
      "Tenantry Core and Pro are in beta until 1.0, which comes no earlier than 10 November 2027. The isolation is tested on every build against SQL Server, PostgreSQL, MySQL and SQLite. Releases are numbered 0.x, and a minor release (0.6 to 0.7) can change the API, with the steps to update in its release notes. Pro releases each minor version with Core's.",
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
              Run jobs and messages as their tenant, audit each tenant’s changes, and onboard, offboard and migrate
              tenants
            </h1>
            <p className={'mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground'}>
              Pro is for two kinds of application. With a shared database, it adds Hangfire, Quartz.NET, MassTransit and
              Rebus work that runs as its tenant, an audit log of each tenant’s changes, and offboarding that deletes a
              tenant’s rows. With a database or schema per tenant, it also creates, migrates, checks and removes them.
              Pro builds on the free, open-source Tenantry Core. One price covers your whole company.
            </p>
            <div className={'mt-8 flex flex-wrap items-center gap-3'}>
              <Button asChild size={'lg'}>
                <TrackedLink href={'/#pricing'} event={'See pricing'} data={{ from: 'pro' }}>
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
                own background work as a tenant with ITenantScopeFactory. If that covers your application, Core is all
                you need.
              </span>
            </p>
          </div>
        </section>

        <section className={'border-b border-border/70 bg-surface'}>
          <ul
            className={
              'mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground md:flex-row md:gap-8 md:px-8'
            }
          >
            {PROOF.map((item) => (
              <li key={item.text}>
                <Link href={item.href} className={'hover:text-foreground hover:underline'}>
                  {item.text}
                </Link>
              </li>
            ))}
          </ul>
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
            <div className={'mt-12'}>
              <Button asChild size={'lg'}>
                <TrackedLink href={'/#pricing'} event={'See pricing'} data={{ from: 'pro, questions' }}>
                  Subscribe to Pro <ArrowRight className={'h-4 w-4'} />
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
