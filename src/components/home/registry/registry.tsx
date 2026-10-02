import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CodeFigure } from '@/components/shared/code-figure';

// Tenantry Core's tenant stores guide (docs/tenant-stores.md), whose code blocks Core's CI builds: its store and its
// caching, wrapped to fit.
const SNIPPET = `public sealed class TenantStore(AppDbContext db) : ITenantStore<string>
{
    public async ValueTask<ITenantDescriptor<string>?> GetTenantAsync(
        string tenantId, CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.TenantId == tenantId, ct);

    public async ValueTask<IReadOnlyList<ITenantDescriptor<string>>> GetAllTenantsAsync(
        CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking()
            .ToListAsync<ITenantDescriptor<string>>(ct);
}

builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromSubdomain(o => o.BaseDomains.Add("example.com"))
    .UseStore<TenantStore>()
    .CacheTenants());`;

export function Registry() {
  return (
    <section className={'border-t border-border/70'}>
      <div
        className={'mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:px-8 md:py-24 lg:grid-cols-[0.9fr_1.1fr]'}
      >
        <div>
          <h2 className={'text-3xl font-bold tracking-tight md:text-4xl'}>Bring your own tenant registry</h2>
          <p className={'mt-4 text-lg leading-relaxed text-muted-foreground'}>
            Tenantry reads your tenants from where your application already keeps them: a table, configuration or
            another service. A store has two methods to implement, finding a tenant by id and listing them all, and a
            third to override when tenants are found by a slug or a custom domain. Creating and changing tenants stays
            in your application.
          </p>
          <Link
            href={'/docs/core/tenant-stores'}
            className={'mt-6 inline-flex items-center gap-1 text-sm font-medium text-link hover:underline'}
          >
            Tenant stores <ArrowRight className={'h-3.5 w-3.5'} />
          </Link>
        </div>
        <CodeFigure code={SNIPPET} caption={'TenantStore.cs'} />
      </div>
    </section>
  );
}
