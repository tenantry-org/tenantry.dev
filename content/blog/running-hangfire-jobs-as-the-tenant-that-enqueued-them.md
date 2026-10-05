---
title: Running Hangfire jobs as the tenant that enqueued them
description: In a shared database, a Hangfire job enqueued in a tenant's request runs with no tenant unless something carries it. What Tenantry Core does, and what Tenantry Pro adds, including suspended tenants.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry Core and Pro 0.7.0, Hangfire 1.8.25, .NET 10, EF Core 10.0.12 and SQLite
tags: [dotnet, hangfire, efcore, multitenancy]
next:
  label: See what Tenantry Pro includes
  href: /pro
draft: true
---

An application on [Tenantry Core](/docs/core) with one shared database filters every EF Core query by the current
tenant and refuses saves without one. A Hangfire job is run later by a worker thread, outside the request that
enqueued it, so by default it has no tenant: its queries match nothing and its saves throw. This post runs one job
three ways against SQLite, with two tenants, Acme with two orders and Globex with one: with Core only, with the tenant
passed by hand, and with Tenantry Pro's Hangfire integration. Hangfire was 1.8.25 with in-memory job storage, and
retries were off so that each failure showed at once.

The code below leaves out the model and the packages. `AppDbContext` has `Orders` and `OrderTotals`, whose entities
implement `ITenantEntity<string>`, and is registered with `UseSqlite(...).UseTenantry()`. `AppTenant` is a tenant
descriptor with a settable `IsActive`. The application references Tenantry.AspNetCore, Tenantry.EfCore,
Microsoft.EntityFrameworkCore.Sqlite, Hangfire.AspNetCore and Hangfire.InMemory.

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
Tenantry.TenantNotResolvedException: SaveChanges is writing tenant-owned entities (OrderTotal) without a resolved
tenant. Run the write while a tenant is current (app.UseTenantry() for requests, ITenantScopeFactory.RunInScopeAsync
or CreateScope elsewhere). Maintenance code that deliberately writes across tenants can use a context of its own,
registered with UseTenantry(o => o.OnMissingTenant = MissingTenantBehavior.Allow).
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
that leaves either out runs as no tenant. Core's guide to
[running work as a tenant](/docs/core/non-http-hosts#running-work-as-a-tenant) describes `RunInScopeAsync` and the
other ways to do it.

## With Tenantry Pro's Hangfire integration

The `Tenantry.Pro.Hangfire` package stores the current tenant with each job when it is enqueued, and makes it current
again before Hangfire creates the job ([Hangfire guide](/docs/pro/hangfire)). Here is the registration, sign-in
included; the `DbContext` is registered with `UseTenantry()` as before:

```csharp
builder.Services.AddAuthentication().AddJwtBearer(o => o.TokenValidationParameters = new()
{
    ValidateIssuer = false,
    ValidateAudience = false,
    IssuerSigningKey = new SymmetricSecurityKey(Convert.FromBase64String(builder.Configuration["Jwt:Key"]!)),
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("Admin", policy => policy.RequireRole("admin"));

builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant")
    .UseInMemoryStore([acme, globex])
    .RequireTenantByDefault()
    .ValidateTenantAccessByClaim("tenant")                     // the caller may use the tenant
    .ValidateTenantActivity(t => t.As<AppTenant>().IsActive)   // the tenant is active
    .UsePro(pro => pro.AddHangfirePropagation()));

builder.Services.AddHangfire((sp, config) => config
    .UseInMemoryStorage()
    .UseFilter(new AutomaticRetryAttribute { Attempts = 0 })   // for this run only
    .UseTenantry(sp));
builder.Services.AddHangfireServer(o => o.SchedulePollingInterval = TimeSpan.FromSeconds(1));   // for this run only
```

```csharp
app.UseAuthentication();
app.UseAuthorization();
app.UseTenantry();
```

It also needs the packages Tenantry.Pro.Hangfire and Microsoft.AspNetCore.Authentication.JwtBearer, a `Jwt:Key` of at
least 32 bytes, base64-encoded, and the Tenantry Pro licence key in `Tenantry:License`. The test tokens were made with
`JsonWebTokenHandler.CreateToken`, signed with the same key using HMAC-SHA256.

Bearer tokens signed with a key from configuration stand in for a real identity provider. A user's token has a
`tenant` claim for each tenant they may use, and an administrator's has the role `admin`. The two validators check
different things. `ValidateTenantAccessByClaim` checks the caller: Acme's user naming Globex in the header got `403`.
`ValidateTenantActivity` checks the tenant: a suspended one is refused whoever asks. The Core-only run above had the
same sign-in and validators.

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
    .AllowMissingTenant()
    .RequireAuthorization("Admin");
```

This endpoint takes the tenant from its route, which Tenantry's access validation never sees, so without
`RequireAuthorization` any caller could enqueue a job as any tenant. With it, an administrator's request to
`/admin/totals/globex`, with no tenant header, got `200` and enqueued a job that ran as Globex and saw its one order.
The same request with no token got `401`, and with Acme's user's token `403`, and neither enqueued a job.

A nightly job for every tenant is added with `AddOrUpdateForEachTenant`. Each time it is due it enqueues the job once
per tenant in the store, and each of those runs as its tenant:

```csharp
recurring.AddOrUpdateForEachTenant<OrderTotalsJob>("nightly-totals", job => job.RunAsync(), Cron.Daily());
```

Triggered once, it produced one run as Acme and one as Globex.

## Suspending a tenant

Suspension here is the `IsActive` flag that `ValidateTenantActivity` reads. I scheduled a job in Globex's request to
run two seconds later, then set Globex's `IsActive` to `false`. Hangfire looks for due scheduled jobs every 15 seconds
by default; this run set `SchedulePollingInterval` to one second. Globex's next request got `403`. When the scheduled
job came due, Tenantry's job filter refused it before it ran:

```text
fail: Hangfire.AutomaticRetryAttribute[0] Failed to process the job '8': an exception occurred.
Tenantry.TenantInactiveException: Tenantry.Pro: Hangfire job 8 carries the tenant 'globex', which is not active
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
warn: Tenantry.Pro.Internal.TenantPropagator[3401] Tenantry.Pro: Hangfire job 7 carries no tenant, so it runs without
one (TenantPropagationOptions.OnMissingTenant is Warn)
    OrderTotalsJob as (no tenant): 0 orders, 0
```

With `OnMissingTenant` set to `Reject`, the same job failed with `TenantNotResolvedException` before it ran.
