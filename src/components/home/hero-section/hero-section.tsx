import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TrackedLink } from '@/components/shared/tracked-link';
import { highlight } from 'fumadocs-core/highlight';
import { Button } from '@/components/ui/button';
import { GithubIcon } from '@/components/icons/github-icon';
import { latestDocsVersion } from '@/lib/docs-versions';

// From Tenantry Core's README and getting-started guide, with the access check that guide asks for in production
// (docs/access-control.md): a header alone lets any caller name any tenant.
const SNIPPET = `builder.Services.AddTenantry<Guid>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")           // names the tenant
    .ValidateTenantAccessByClaim("tenant_id")   // the user may use it
    .UseInMemoryStore(tenants));                // lists the tenants

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry());                            // isolates the data

// Tenant-owned: stamped on insert, filtered in every query.
public class Order : ITenantEntity<Guid>
{
    public int Id { get; set; }
    public Guid TenantId { get; private set; }
}`;

// Highlighted once and cached: highlighting reads the clock (Date.now()), which prerendering refuses otherwise.
async function highlightedSnippet() {
  'use cache';
  return highlight(SNIPPET, {
    lang: 'csharp',
    theme: 'github-dark-default',
  });
}

export async function HeroSection() {
  const code = await highlightedSnippet();

  return (
    <section className={'relative overflow-hidden border-b border-border/70'}>
      <div
        aria-hidden={true}
        className={
          'pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,var(--surface),var(--background))]'
        }
      />
      <div
        className={
          'relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 md:px-8 md:pt-24 lg:grid-cols-[1.05fr_1fr]'
        }
      >
        <div className={'flex flex-col items-start'}>
          <span
            className={
              'inline-flex items-center gap-2 rounded-full border border-accent-foreground/15 bg-accent px-3 py-1 text-xs font-medium text-accent-foreground'
            }
          >
            Beta · {latestDocsVersion.version} · 1.0 not before November 2027
          </span>
          <h1
            className={
              'mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]'
            }
          >
            Stop one missed WHERE clause <span className={'text-link'}>from leaking a customer’s data.</span>
          </h1>
          <p className={'mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground'}>
            Tenantry adds tenant isolation to your ASP.NET Core and EF Core app with one call on the DbContext you
            already have. No base class, no new tenants table. With no tenant, queries return nothing, and a forged
            tenant key changes no rows.
          </p>
          <div className={'mt-8 flex flex-wrap items-center gap-3'}>
            <Button asChild size={'lg'}>
              <TrackedLink href={'/docs/core/getting-started'} event={'Get started with Core'} data={{ from: 'home' }}>
                Get started with Core, free <ArrowRight className={'h-4 w-4'} />
              </TrackedLink>
            </Button>
            <Button asChild size={'lg'} variant={'outline'}>
              <Link
                href={'https://github.com/tenantry-org/tenantry-core'}
                target={'_blank'}
                rel={'noopener noreferrer'}
              >
                <GithubIcon className={'h-4 w-4'} /> View Core on GitHub
              </Link>
            </Button>
          </div>
        </div>

        <figure
          className={
            'min-w-0 overflow-hidden rounded-xl border border-border bg-code shadow-[0_24px_48px_-24px_rgb(0_0_0/0.6)]'
          }
        >
          <figcaption
            className={
              'flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground'
            }
          >
            <span className={'font-mono'}>Program.cs</span>
            <span>Tenantry Core</span>
          </figcaption>
          <div
            className={
              'overflow-x-auto py-4 font-mono text-[13px] leading-6 [font-variant-ligatures:none] [&_pre]:bg-transparent!'
            }
          >
            {code}
          </div>
        </figure>
      </div>
    </section>
  );
}
