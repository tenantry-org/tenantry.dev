---
title: A test that fails when an EF Core entity is not tenant-isolated
description: An xUnit test that lists the entity types with no tenant isolation, first from EF Core's model and then with Tenantry, what it caught, and what Tenantry refuses or logs without it.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry 0.7.0, .NET 10, EF Core 10.0.12, xUnit v3 3.2.2 and SQLite
tags: [dotnet, efcore, multitenancy, testing]
next:
  label: See what Tenantry isolates in EF Core
  href: /docs/core/efcore-integration#what-is-and-isnt-isolated
draft: true
---

In a shared database, an entity type is isolated only when something filters its queries by tenant. A type added
later without that is read and written by every tenant, and nothing fails: its queries return rows and its saves
succeed. This post adds a unit test that fails instead, first over EF Core's model alone and then with
[Tenantry Core](/docs/core), and shows what it caught.

## The test over EF Core's model

An application that adds the tenant filter itself, with `HasQueryFilter` in `OnModelCreating`, can check that every
entity type has a filter, apart from those every tenant shares:

```csharp
public class TenantFilterTests
{
    [Fact]
    public void EveryEntityTypeHasAQueryFilterOrIsShared()
    {
        string[] shared = ["Country", "Currency"];
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options;
        using var db = new AppDbContext(options);

        var unfiltered = db.Model.GetEntityTypes()
            .Where(e => e.BaseType is null && !e.IsOwned() && e.GetDeclaredQueryFilters().Count == 0)
            .Select(e => e.DisplayName())
            .Except(shared);

        Assert.Empty(unfiltered);
    }
}
```

The test builds the model and stops there: it opens no connection and needs no tenant or application services. EF Core
takes a hierarchy's filter from its root and loads an owned type with its owner, so the test looks at the other types
only.

The context filters `Order` and `Customer` by tenant, and every tenant reads `Country` and `Currency`. Then I added a
`Note` entity without a filter. The test failed:

```text
TenantFilterTests.EveryEntityTypeHasAQueryFilterOrIsShared [FAIL]
  Assert.Empty() Failure: Collection was not empty
  Collection: ["Note"]
```

It checks that a filter exists, not what it compares, so a type whose only filter hides deleted rows passes.

## The same test with Tenantry

With Tenantry Core, an entity type is isolated when it implements `ITenantEntity<TKey>`, and Tenantry says which are
not:

```csharp
public class TenantIsolationTests
{
    [Fact]
    public void EveryEntityTypeIsTenantOwnedOrShared()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite("Data Source=:memory:")
            .UseTenantry()
            .Options;
        using var db = new AppDbContext(options);

        var unisolated = TenantModel.FindUnisolatedEntityTypes(db.Model).Select(e => e.DisplayName());

        Assert.Empty(unisolated);
    }
}
```

`TenantModel.FindUnisolatedEntityTypes` returns the entity types that are neither tenant-owned nor marked as shared by
every tenant. Here `Order` and `Customer` are tenant-owned, and the shared types are marked in place of a list in the
test, one in the model and one with an attribute:

```csharp
modelBuilder.Entity<Country>().IsSharedAcrossTenants();
```

```csharp
[SharedAcrossTenants]
public class Currency
{
    public string Code { get; set; } = "";
}
```

With `Note` added without `ITenantEntity<string>`, the test failed:

```text
TenantIsolationTests.EveryEntityTypeIsTenantOwnedOrShared [FAIL]
  Assert.Empty() Failure: Collection was not empty
  Collection: ["Note"]
```

With `Note : ITenantEntity<string>` and a `TenantId` property, it passed. A type whose rows belong to no tenant would
be marked as shared instead, which leaves a line in the model saying so.

## Models Tenantry refuses

Some mistakes do not reach the test, because Tenantry refuses to build the model. An `Invoice` that implements
`ITenantEntity<string>` but derives from a `Document` that does not is one. The Tenantry test, pointed at that
context, failed with:

```text
Tenantry.EfCore.TenantIsolationViolationException : Entity 'Invoice' is tenant-owned but its base entity type
'Document' is not. EF Core applies query filters to the root of an inheritance hierarchy only, so implement
ITenantEntity<String> on 'Document'.
```

In the running application the same exception came from the context's first use, `EnsureCreatedAsync` in mine. The
[EF Core guide](/docs/core/efcore-advanced#models-that-cannot-be-isolated) lists the other models Tenantry refuses.

## A write to another tenant's row

A correct model does not stop code from trying to change another tenant's data. Here an order loaded in Globex's
scope has its tenant changed:

```csharp
var order = await db.Orders.SingleAsync(ct);
order.TenantId = "acme";
await db.SaveChangesAsync(ct);
```

`SaveChangesAsync` threw `TenantIsolationViolationException` and wrote nothing, and Tenantry logged this at `Error`:

```text
fail: Tenantry.EfCore[2001] Tenant isolation violation: entity 'Order' belongs to tenant 'acme' but the current
tenant is 'globex'. Aborting SaveChanges
```

The event id, 2001 in the category `Tenantry.EfCore`, is stable, so a log alert can match on it. In production it
means a request tried to write across tenants and failed.

## What the test does not check

The test reads the model, and the model says nothing about the queries the application runs. In Acme's scope,
`db.Orders.CountAsync()` returned 1 and `db.Orders.IgnoreQueryFilters().CountAsync()` returned 2, Globex's order
included. SQL sent with `Database.SqlQuery` read every tenant's rows too. Tenantry's
[analyzers](/docs/core/analyzers) report both calls when the project builds: `IgnoreQueryFilters()` on a tenant-owned
entity as warning TNY1002, and `SqlQuery` as TNY1003, which is info by default. TNY1001 reports an entity with a
`TenantId` property that does not implement `ITenantEntity<TKey>`; `Note`, with no `TenantId`, was not reported.

The test also passed for a context whose options do not call `UseTenantry()`, which isolates nothing.

The same model check can run in the application. With `OnUnmarkedEntityType` set to `Reject`, the context with `Note`
threw at its first save:

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .UseInMemoryStore([acme, globex])
    .ConfigureEfCoreIsolation(o => o.OnUnmarkedEntityType = UnmarkedEntityTypeBehavior.Reject));
```

```text
Tenantry.EfCore.TenantIsolationViolationException: 'AppDbContext' requires every entity type that is not tenant-owned
to be marked as shared across tenants (EfCoreIsolationOptions.OnUnmarkedEntityType = Reject), and these are not:
Note. Mark each that every tenant shares with [SharedAcrossTenants] or, in OnModelCreating, IsSharedAcrossTenants(),
and implement ITenantEntity<String> on each whose rows belong to a tenant.
```

With `Warn`, it logged event 2006 once and went on. The default, `Allow`, checks nothing.
