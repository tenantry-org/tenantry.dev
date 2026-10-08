import { Fragment, Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';
import { Pricing } from '@/components/home/pricing/pricing';
import { ProPriceSentence } from '@/components/home/pricing/pro-price-sentence';
import { Button } from '@/components/ui/button';
import { CodeFigure } from '@/components/shared/code-figure';
import { ProofStrip } from '@/components/shared/proof-strip';
import { TrackedLink } from '@/components/shared/tracked-link';
import { DOTNET_SUPPORT } from '@/constants/dotnet-support';
import { SUPPORT_REPLY_WITHIN } from '@/constants/pro-offer';
import { VESTING_RULES } from '@/constants/vesting';
import { latestDocsVersion, publishedSince } from '@/lib/docs-versions';

export const metadata: Metadata = {
  title: 'Tenantry Pro: multi-tenant migrations, provisioning and jobs',
  description:
    'For multi-tenant .NET apps: migrate and provision tenant databases or schemas, run jobs and messages as their tenant, audit changes and offboard tenants.',
  alternates: { canonical: '/pro' },
};

// From Tenantry Pro's guides (tenant migrations, tenant lifecycle, Hangfire, audit logging), shortened to the outcome,
// an example and a limitation; each sample uses the API of the Pro release the site shows.
const WORKFLOWS = [
  {
    title: 'Keep every tenant database migrated',
    text: 'Run migrate-tenants as a deployment step to apply pending migrations to every tenant database or schema. It tries every one, unless --max-failures or a stop signal ends the run early, and exits non-zero unless every one migrated, which stops the release. Run one at a time: two runs from overlapping deployments race, and with EF Core 8 on MySQL a race inside a larger migration can leave it half applied.',
    caption: 'Program.cs',
    code: `await using var app = builder.Build();

// dotnet run -- migrate-tenants
if (await app.RunTenantMigrationsIfRequestedAsync(args) is { } exitCode)
    return exitCode;   // not 0 unless every database and schema migrated

app.UseTenantry();   // Tenantry Core: resolves the tenant and opens the scope for the request
await app.RunAsync();
return 0;`,
    link: { label: 'Tenant migrations', href: '/docs/pro/migration-orchestration' },
  },
  {
    title: 'Onboard and offboard tenants',
    text: 'One call creates a tenant’s database or schema, migrates it and runs your own steps, such as seeding its data. Offboarding refuses a tenant that is still active and runs your export steps first. Then, with the step registered, it drops the tenant’s database or schema or, in a shared database, deletes its rows from the tenant-owned tables in one transaction per context. A failed run is retried by running it again, so your steps must be safe to repeat.',
    caption: 'TenantOnboarding.cs',
    code: `tenant.UsePro(pro => pro
    .AddProvisioningStep<SeedInitialData>()       // your step, last
    .AddDatabaseProvisioning<AppDbContext>()      // creates the database, first
    .AddMigrations<AppDbContext>());              // then migrates it

${
  publishedSince('pro', 'v0.8.0')
    ? `// Once every step has succeeded, activates the tenant and invalidates its cached copy:
var result = await provisioner.ProvisionAsync(
    descriptor, token => tenants.ActivateAsync(descriptor.TenantId, token), ct);`
    : `var result = await provisioner.ProvisionAsync(descriptor, ct);
if (result.Succeeded)
    await tenants.ActivateAsync(descriptor.TenantId, ct);`
}`,
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

// When a team needs Pro, from the failures the migrations post lists and the workflows above.
const NEEDS_PRO = [
  'migrating each tenant database in a loop at startup gets slow, or one failure leaves tenants on different schemas',
  'a new tenant needs its database or schema created, migrated and seeded before its first request',
  'your jobs or messages run on Hangfire, Quartz.NET, MassTransit or Rebus and must run as their tenant',
  'a tenant leaves, and its rows, database or schema must be removed',
  'you need a record of who changed each tenant’s data, and when',
  'you want a schema per tenant, or some tenants in their own database and the rest in a shared one',
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
    answer: (
      <>
        {/* Pro's price from Paddle, so the page states it without Paddle.js; streamed in when the page is requested. */}
        <Suspense fallback={null}>
          <ProPriceSentence />
        </Suspense>
        {`Every Tenantry Pro release while you subscribe, a licence key, and email support with a reply within ${SUPPORT_REPLY_WITHIN}. Releases come from the package feed, Tenantry’s private NuGet feed. After 12 paid months in total or a year paid up front, you keep releases when the subscription ends.`}
      </>
    ),
    link: { label: 'What you keep', href: '#subscription-ends' },
  },
  {
    question: 'How does my team install it, locally and in CI?',
    answer:
      'Create a feed token on your Pro access page and add the package feed to your nuget.config, which reads the token from an environment variable. NuGet then restores Tenantry Pro from the package feed and everything else from nuget.org. Up to 10 feed tokens can exist at once; one per developer machine and CI system lets you revoke each on its own. No GitHub account is needed, and everyone in your company may use Pro. The guide covers CI and Docker builds.',
    link: { label: 'Installation', href: '/docs/pro/installation' },
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
    question: 'Can I check a release’s packages?',
    answer: `Core’s, from the first release after 0.7.0. Each Core release attaches its packages to its GitHub release with their SHA-256 checksums, SBOMs and a build provenance attestation, which shows the release workflow built them from the tagged commit. Check those copies: NuGet.org signs the packages it serves, so its copies do not match the checksums. ${
      publishedSince('pro', 'v0.8.0')
        ? 'Pro’s, from 0.8.0. The SHA-256 checksums of each Pro release’s packages, signed with Sigstore by its release workflow, are in the public tenantry-pro-docs repository at the release’s tag, and the package feed serves the packages unchanged.'
        : 'Pro releases have no published checksums or attestation.'
    }`,
    link: [
      {
        label: 'Checking a Core release',
        href: 'https://github.com/tenantry-org/tenantry-core/blob/master/RELEASING.md#the-release',
      },
      ...(publishedSince('pro', 'v0.8.0')
        ? [{ label: 'Checking a Pro package', href: '/docs/pro/installation#checking-a-package' }]
        : []),
    ],
  },
  {
    question: 'Can I try Pro before I buy it?',
    answer:
      'There is no free trial. You may request a full refund within 14 days of your initial purchase, as the refund policy sets out. Pro’s documentation and samples are public, so you can read how it works before you subscribe.',
    link: { label: 'Refund policy', href: '/legal/refunds' },
  },
  {
    question: 'Is Pro’s source available?',
    answer:
      'No. Pro ships as compiled packages with their debug symbols built in, so stack traces show Pro’s file names and line numbers, but a debugger cannot show its source. Pro’s documentation and samples are public. If Tenantry stops trading and the package feed goes offline for good, you can request the source of the releases you keep, as the last answer on this page sets out.',
  },
  {
    question: 'How does a company buy it?',
    answer:
      'Only through the checkout on this site. Paddle runs it as our merchant of record and handles tax and invoices. There are no seats or tiers.',
    link: { label: 'EULA', href: '/legal/eula' },
  },
  {
    question: 'Can I ship Pro inside software my customers install?',
    answer:
      'Yes, as part of your application, including one your customers install or host themselves. They may not use Pro on its own.',
    link: { label: 'EULA', href: '/legal/eula' },
  },
  {
    question: 'Does it phone home?',
    answer:
      'No. The licence key is checked offline when the application starts, and it does not expire. It does not decide which releases you may use: your subscription and the EULA do.',
    link: { label: 'Licensing', href: '/docs/pro/licensing' },
  },
  {
    question: 'What happens when the subscription ends?',
    // The price cards and the first answer link here.
    id: 'subscription-ends',
    answer: `After 12 paid months in total, gaps allowed, or a year paid up front, you keep every release published up to your vested-through date, the end of the time you paid for, with its later patches. The package feed keeps serving them and your licence key keeps working; later releases are not licensed to you. With less paid time, your licence to Pro ends with the subscription and you stop using it. Only a refund, credit or chargeback takes kept releases away. If you subscribe again, the paid time you kept still counts. A kept Pro minor stays on the Core minor of the same number (Pro ${latestDocsVersion.version} on Core ${latestDocsVersion.version}.x).`,
    link: [
      { label: 'EULA', href: VESTING_RULES },
      { label: 'Compatibility', href: '/docs/pro/compatibility#tenantry-core' },
    ],
  },
  {
    question: 'How long is a release patched?',
    answer:
      'Until 1.0, security fixes are released as a patch to the latest two Pro minor versions. Pro minor versions released before Tenantry Pro went on sale were internal development builds, and they are not patched.',
    link: {
      label: 'Licensing',
      href: publishedSince('pro', 'v0.8.0') ? '/docs/pro/licensing#security-patches' : '/docs/pro/licensing',
    },
  },
  {
    question: 'What if Tenantry stops?',
    answer:
      'Core stays Apache-2.0 on GitHub, and the Pro releases you keep stay licensed and keep working, as when a subscription ends. If Tenantry fully ceases commercial operations and the package feed goes offline permanently, you can request copies of the packages of those releases, with a copy of their source code, by email to support@tenantry.dev.',
    link: { label: 'EULA', href: '/legal/eula' },
  },
];

export default function ProPage() {
  return (
    <>
      <Header pricingHref={'#pricing'} />
      <main>
        <section className={'border-b border-border/70'}>
          <div className={'mx-auto max-w-6xl px-4 pb-16 pt-16 md:px-8 md:pt-24'}>
            <p className={'text-sm font-medium text-link'}>Tenantry Pro</p>
            <h1 className={'mt-3 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl'}>
              Provision and offboard tenants, migrate their databases, run their jobs and audit their changes
            </h1>
            <p className={'mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground'}>
              Pro builds on the free, open-source Tenantry Core. With a database or schema per tenant, it creates them
              and migrates them all as a deployment step. With any layout, a shared database included, it runs Hangfire,
              Quartz.NET, MassTransit and Rebus work as its tenant, keeps an audit log of each tenant’s changes, and
              offboards a tenant by deleting its rows or dropping its database or schema. One price covers your whole
              company.
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
            <div className={'mt-10 max-w-2xl rounded-xl border border-border bg-card p-5 text-sm leading-relaxed'}>
              <p>
                <span className={'font-semibold'}>Do I need Pro?</span>{' '}
                <span className={'text-muted-foreground'}>
                  Not to keep tenants’ data apart: Core does that, with a shared database or a database per tenant. Core
                  already runs your own background work as a tenant with ITenantScopeFactory; Pro adds the Hangfire,
                  Quartz.NET, MassTransit and Rebus integrations. Pro is for when:
                </span>
              </p>
              <ul className={'mt-2 list-disc pl-5 text-muted-foreground'}>
                {NEEDS_PRO.map((need) => (
                  <li key={need}>{need}</li>
                ))}
              </ul>
              <p className={'mt-2 text-muted-foreground'}>Until then, Core is all you need.</p>
            </div>
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
                <div key={item.question} id={item.id} className={'scroll-mt-16'}>
                  <dt className={'font-semibold'}>{item.question}</dt>
                  <dd className={'mt-2 leading-relaxed text-muted-foreground'}>
                    {item.answer}
                    {[item.link ?? []].flat().map((link) => (
                      <Fragment key={link.href}>
                        {' '}
                        <TrackedLink
                          href={link.href}
                          event={'Pro question link'}
                          data={{ to: link.href }}
                          className={'text-link hover:underline'}
                        >
                          {link.label}
                        </TrackedLink>
                      </Fragment>
                    ))}
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
