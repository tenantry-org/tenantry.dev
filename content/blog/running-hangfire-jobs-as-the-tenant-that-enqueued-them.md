---
title: Running Hangfire jobs as the tenant that enqueued them, in a shared database
description: A Hangfire job enqueued in a tenant's request runs with no tenant unless something carries it. What Tenantry Core does on its own, and what Tenantry Pro's Hangfire integration adds, including suspended tenants.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry Core and Pro 0.6.0, Hangfire 1.8.25, .NET 10, EF Core 10.0.12 and SQLite
tags: [dotnet, hangfire, efcore, multitenancy]
next:
  label: Read the Hangfire guide
  href: /docs/pro/hangfire
draft: true
---

An application on [Tenantry Core](/docs/core) with one shared database filters every EF Core query by the current
tenant and refuses saves without one. A Hangfire job is run later by a worker thread, outside the request that
enqueued it, so by default it has no tenant: its queries match nothing and its saves throw. This post runs one job
three ways against SQLite, with two tenants, Acme with two orders and Globex with one: with Core only, with the tenant
passed by hand, and with Tenantry Pro's Hangfire integration. Hangfire was 1.8.25 with in-memory job storage, and
retries were off so that each failure showed at once.

The job adds up the current tenant's orders and saves the result:

```csharp
public class OrderTotalsJob(AppDbContext db, ITenantContext<string> tenants)
{
    public async Task RunAsync()
    {
        var orders = await db.Orders.ToListAsync();
        Console.WriteLine($"    OrderTotalsJob as {tenants.CurrentTenantId ?? "(no tenant)"}: {orders.Count} orders, {orders.Sum(o => o.Total)}");
        db.OrderTotals.Add(new OrderTotal { Orders = orders.Count, Total = orders.Sum(o => o.Total) });
        await db.SaveChangesAsync();
    }
}
```

An endpoint enqueues it, in a request that names its tenant in a header:

```csharp
app.MapPost("/totals", (IBackgroundJobClient jobs) => jobs.Enqueue<OrderTotalsJob>(job => job.RunAsync()));
```

## With Tenantry Core only

Enqueued in Acme's request, the job ran with no tenant, read no orders and failed on save:

```text
    OrderTotalsJob as (no tenant): 0 orders, 0
fail: Hangfire.AutomaticRetryAttribute[0] Failed to process the job '1': an exception occurred.
Tenantry.TenantNotResolvedException: SaveChanges is writing tenant-scoped entities (OrderTotal) without a resolved
tenant. Run the write while a tenant is current (app.UseTenantry() for requests, ITenantScopeFactory.RunInScopeAsync
or CreateScope elsewhere). [...]
```

Core can run the job as its tenant if the job is given the tenant's id and opens the tenant's scope itself:

```csharp
public class OrderTotalsForTenantJob(ITenantScopeFactory<string> scopes)
{
    public Task RunAsync(string tenantId, CancellationToken ct) =>
        scopes.RunInScopeAsync(tenantId, async (scope, token) =>
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var orders = await db.Orders.ToListAsync(token);
            Console.WriteLine($"    OrderTotalsForTenantJob as {tenantId}: {orders.Count} orders, {orders.Sum(o => o.Total)}");
            db.OrderTotals.Add(new OrderTotal { Orders = orders.Count, Total = orders.Sum(o => o.Total) });
            await db.SaveChangesAsync(token);
        }, ct);
}
```

```csharp
app.MapPost("/totals-core", (IBackgroundJobClient jobs, ITenantContext<string> tenants) =>
{
    var tenantId = tenants.CurrentTenantId!;
    return jobs.Enqueue<OrderTotalsForTenantJob>(job => job.RunAsync(tenantId, CancellationToken.None));
});
```

That ran as Acme and saw its two orders, totalling 150. `RunInScopeAsync` also applies `ValidateTenantActivity`: with
Globex suspended, the same job for Globex failed with `TenantInactiveException: Tenant 'globex' is not active, so no
work runs for it.` This is enough for a few jobs. Every job then takes a tenant id and opens its own scope, and a job
that leaves either out runs as no tenant.

## With Tenantry Pro's Hangfire integration

The `Tenantry.Pro.Hangfire` package stores the current tenant with each job when it is enqueued, and makes it current
again before Hangfire creates the job:

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant")
    .UseInMemoryStore([acme, globex])
    .RequireTenantByDefault()
    .ValidateTenantActivity(t => t.As<AppTenant>().IsActive)
    .UsePro(pro => pro.AddHangfirePropagation()));

builder.Services.AddHangfire((sp, config) => config
    .UseInMemoryStorage()
    .UseFilter(new AutomaticRetryAttribute { Attempts = 0 })   // for this run only
    .UseTenantry(sp));
builder.Services.AddHangfireServer();
```

`OrderTotalsJob` and the `/totals` endpoint are unchanged. Enqueued in each tenant's request, the job ran as that
tenant, with its `DbContext` and `ITenantContext<string>` resolved in the tenant's scope:

```text
acme POST /totals -> 200 1
    OrderTotalsJob as acme: 2 orders, 150.0
globex POST /totals -> 200 2
    OrderTotalsJob as globex: 1 orders, 200.0
```

The tenant is kept in the job's parameters, under `tenantry-tenant-id`; for an Acme job, Hangfire's storage held
`"acme"`.

Leaving `UseTenantry(sp)` out of Hangfire's configuration would let jobs run without their tenant, so the host
refused to start:

```text
System.InvalidOperationException: Tenantry.Pro: pro.AddHangfirePropagation() was called, but not its host side: call
UseTenantry(sp) on Hangfire's configuration, as in services.AddHangfire((sp, config) => config.UseTenantry(sp)) with
Hangfire.NetCore. Without it, jobs and messages do not carry the tenant.
```

Administrator code that runs without a tenant names one with `WithTenant`:

```csharp
app.MapPost("/admin/totals/{tenantId}", (string tenantId, IBackgroundJobClient jobs) =>
    jobs.WithTenant(tenantId).Enqueue<OrderTotalsJob>(job => job.RunAsync()))
    .AllowMissingTenant();
```

A request to `/admin/totals/globex` with no tenant header enqueued a job that ran as Globex and saw its one order.

A nightly job for every tenant is added with `AddOrUpdateForEachTenant`. Each time it is due it enqueues the job once
per tenant in the store, and each of those runs as its tenant:

```csharp
recurring.AddOrUpdateForEachTenant<OrderTotalsJob>("nightly-totals", job => job.RunAsync(), Cron.Daily());
```

Triggered once, it produced one run as Acme and one as Globex.

## Suspending a tenant

Suspension here is the `IsActive` flag that `ValidateTenantActivity` reads. I scheduled a job in Globex's request to
run two seconds later, then set Globex's `IsActive` to `false`. Globex's next request got `403`. When the scheduled
job came due, Tenantry's job filter refused it before it ran:

```text
fail: Hangfire.AutomaticRetryAttribute[0] Failed to process the job '9': an exception occurred.
Tenantry.TenantInactiveException: Tenantry.Pro: Hangfire job 9 carries the tenant 'globex', which is not active
(ValidateTenantActivity), and TenantPropagationOptions.OnUnresolvedTenant is Reject.
```

`Reject` is the default, and Hangfire records the job as failed, with its retry policy applied. With
`OnUnresolvedTenant` set to `Skip`, the same job was deleted instead, with the reason "Canceled by filter
'TenantJobFilter'". Triggered again, the nightly job enqueued a run for Acme only.

## What it does not cover

A job runs as whichever tenant its parameters name, so the job storage has to be writable by the application alone:
anyone who can change a row there can run a job as another tenant.

The per-tenant recurring job keeps no record of the tenants it has already enqueued. If its run fails or is stopped
part-way, Hangfire runs it again and it enqueues a job for every tenant again, so the job has to be safe to run twice
for the same tenant.

A recurring job added with Hangfire's own `RecurringJob.AddOrUpdate` is created by the scheduler, outside any
request, and carries no tenant. Triggered, it logged a warning, ran with no tenant and failed on save, as in the
Core-only run:

```text
warn: Tenantry.Pro.Internal.TenantPropagator[3401] Tenantry.Pro: Hangfire job 8 carries no tenant, so it runs without
one (TenantPropagationOptions.OnMissingTenant is Warn)
    OrderTotalsJob as (no tenant): 0 orders, 0
```

With `OnMissingTenant` set to `Reject`, the same job failed with `TenantNotResolvedException` before it ran.
