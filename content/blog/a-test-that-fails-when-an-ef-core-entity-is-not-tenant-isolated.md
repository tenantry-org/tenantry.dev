---
title: A test that fails when an EF Core entity is not tenant-isolated
description: An xUnit test that lists the entity types Tenantry does not isolate, what it caught, and what Tenantry refuses or logs without it.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry 0.6.0, .NET 10, EF Core 10.0.12, xUnit v3 3.2.2 and SQLite
tags: [dotnet, efcore, multitenancy, testing]
next:
  label: See what Tenantry isolates in EF Core
  href: /docs/core/efcore-integration#what-is-and-isnt-isolated
draft: true
---

In a shared database, [Tenantry Core](/docs/core) isolates an entity type only when it implements
`ITenantEntity<TKey>`. A type added later without it is read and written by every tenant, and nothing fails: its
queries return rows and its saves succeed. This post adds a unit test that fails instead, and shows what it caught.

## The test

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
every tenant. The test builds the model and stops there: it opens no connection and needs no tenant or
application services.

The context has two tenant-owned types, `Order` and `Customer`, and two that every tenant reads, `Country` and
`Currency`. Each of those is marked as shared, one in the model and one with an attribute:

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

Then I added a `Note` entity without `ITenantEntity<string>`. The test failed:

```text
TenantIsolationTests.EveryEntityTypeIsTenantOwnedOrShared [FAIL]
  Assert.Empty() Failure: Collection was not empty
  Collection: ["Note"]
```

With `Note : ITenantEntity<string>` and a `TenantId` property, it passed. A type whose rows belong to no tenant would
be marked as shared instead, which leaves a line in the model saying so.

## Models Tenantry refuses

Some mistakes do not reach the test, because Tenantry refuses to build the model. An `Invoice` that implements
`ITenantEntity<string>` but derives from a `Document` that does not is one. The test above, pointed at that context,
failed with:

```text
Tenantry.EfCore.TenantIsolationViolationException : Entity 'Invoice' is tenant-owned but its base entity type
'Document' is not. EF Core applies query filters to the root of an inheritance hierarchy only, so implement
ITenantEntity<String> on 'Document'.
```

In the running application the same exception came from the first query. The
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
included. SQL sent with `Database.SqlQuery` read every tenant's rows too. Both need review, or a search of the code
for those calls.

The test also passed for a context whose options do not call `UseTenantry()`, which isolates nothing.
