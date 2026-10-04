---
title: Keeping HybridCache and output-cache entries per tenant in ASP.NET Core
description: Two calls in AddTenantry key HybridCache entries and cached responses by tenant. What they returned for two tenants, with no tenant, after invalidation and on a second instance.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry 0.6.0, .NET 10 and Microsoft.Extensions.Caching.Hybrid 10.10.0
tags: [dotnet, aspnetcore, caching, multitenancy]
next:
  label: Read the caching guide
  href: /docs/core/caching
draft: true
---

A `HybridCache` entry under `"orders:recent"`, or a cached response for `/catalogue`, belongs to whichever tenant filled
it, and the next tenant to ask gets the same bytes. Putting the tenant id into every key by hand protects only the calls
that do it. This post turns on [Tenantry Core](/docs/core)'s cache isolation in an ASP.NET Core application with two
tenants, Acme and Globex, and shows what each cache returned. I ran it on .NET 10 with Tenantry 0.6.0, through ASP.NET
Core's test server.

```bash
dotnet add package Tenantry.AspNetCore
dotnet add package Tenantry.Caching
dotnet add package Microsoft.Extensions.Caching.Hybrid
```

## Registration

```csharp
builder.Services.AddHybridCache();
builder.Services.AddOutputCache();
builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant")
    .UseInMemoryStore(
    [
        new TenantDescriptor<string> { TenantId = "acme", Name = "Acme" },
        new TenantDescriptor<string> { TenantId = "globex", Name = "Globex" },
    ])
    .RequireTenantByDefault()
    .IsolateCaches()
    .IsolateOutputCache());

var app = builder.Build();
app.UseTenantry();
app.UseOutputCache();
```

`IsolateCaches()` wraps the `HybridCache` registered before it. With `AddHybridCache()` moved after `AddTenantry`,
the host refused to start:

```text
System.InvalidOperationException: AddHybridCache() was called after AddTenantry, so IsolateCaches() found no
HybridCache to isolate and HybridCache is not available. Register it first: builder.Services.AddHybridCache(), then
builder.Services.AddTenantry(...).
```

## HybridCache

Code that injects `HybridCache` stays as it was. In this service the factory returns the tenant it ran as and the
next number from a counter, in place of a query through the tenant's `DbContext`:

```csharp
public sealed class RecentOrders(HybridCache cache, ITenantContext<string> tenants, Counters n)
{
    public ValueTask<string> GetAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync("orders:recent", _ =>
            ValueTask.FromResult($"{tenants.CurrentTenantId}'s recent orders, built {n.Next()}"), cancellationToken: ct);
}
```

Four requests to an endpoint that calls it, alternating tenants:

```text
acme GET /orders/recent -> 200 acme's recent orders, built 1
globex GET /orders/recent -> 200 globex's recent orders, built 2
acme GET /orders/recent -> 200 acme's recent orders, built 1
globex GET /orders/recent -> 200 globex's recent orders, built 2
```

The one key held an entry for each tenant, and each factory ran once, with its own tenant current. In the second-level
cache the keys were written as `t:acme:orders:recent` and `t:globex:orders:recent`.

Exchange rates are the same for everyone, so that service injects `SharedHybridCache`:

```csharp
public sealed class ExchangeRates(SharedHybridCache cache, Counters n)
{
    public ValueTask<string> GetAsync(string currency, CancellationToken ct) =>
        cache.GetOrCreateAsync($"fx:{currency}", _ => ValueTask.FromResult($"{currency} 1.17, built {n.Next()}"),
            cancellationToken: ct);
}
```

Requests as Acme, as Globex and with no tenant all returned `EUR 1.17, built 5`, from one entry stored as `s:fx:EUR`.

`HybridCache` itself needs a tenant. An endpoint marked `AllowMissingTenant()` that called it with no tenant got:

```text
Tenantry.TenantNotResolvedException: No tenant is current, and HybridCache keeps entries per tenant
(IsolateCaches()). Use it while a tenant is current, or inject SharedHybridCache for entries every tenant shares.
```

## The output cache

```csharp
app.MapGet("/catalogue", (ITenantContext<string> tenants, Counters n) =>
    $"{tenants.CurrentTenantId}'s catalogue, response {n.Next()}").CacheOutput();
```

```text
acme GET /catalogue -> 200 acme's catalogue, response 3
globex GET /catalogue -> 200 globex's catalogue, response 4
acme GET /catalogue -> 200 acme's catalogue, response 3
globex GET /catalogue -> 200 globex's catalogue, response 4
```

The output cache has to run after `app.UseTenantry()`, because the tenant is not known before it. With the two calls
the other way round, nothing was cached, each request got a new response, and Tenantry logged one warning:

```text
warn: Tenantry.AspNetCore.OutputCache[1009] The output cache ran before app.UseTenantry() for request GET /catalogue,
so its response was not cached: IsolateOutputCache() caches only responses for requests app.UseTenantry() handled.
Call app.UseTenantry() before app.UseOutputCache(). Logged once
```

## Invalidating one tenant

When a tenant's data changes underneath its cache, `ITenantInvalidator<TKey>` removes its entries:

```csharp
await invalidator.InvalidateAsync("acme");
```

After that call, Acme's recent orders were built again (`built 6`) and its catalogue was rendered again
(`response 7`). Globex still got `built 2` and `response 4`, and the shared exchange rate was still `built 5`.

## What invalidation does not reach

`IsolateCaches()` leaves `IDistributedCache` alone, since framework components use it outside any tenant. Code that
uses it directly for a tenant's data injects `ITenantDistributedCache`, which puts the tenant in each key:

```csharp
await cache.SetAsync($"draft:{id}", Encoding.UTF8.GetBytes("draft text"), new DistributedCacheEntryOptions(), ct);
```

Acme's draft was stored as `t:acme:draft:7`, and Globex read nothing under the same key. After
`InvalidateAsync("acme")`, Acme still read `draft text`: these entries cannot be removed by tag, and stay until they
expire.

Invalidation also clears only the instance that runs it. I started a second instance of the application, B, sharing the
first one's second-level cache, as two servers would share Redis. B read Acme's recent orders from that cache
(`built 1`; its factory, which shares the counter, did not run). After instance A invalidated Acme, B still returned
`built 1` from its own memory. Microsoft's `HybridCache` records the invalidation in the second level, but an instance
keeps the copies it already holds until they expire. Where a stale copy matters, keep `Expiration` and
`LocalCacheExpiration` short. The output cache's default store is in memory and per instance in the same way.

Each key also gets longer by the tenant's id and a prefix, which counts against `HybridCache`'s maximum key length,
1,024 characters by default.
