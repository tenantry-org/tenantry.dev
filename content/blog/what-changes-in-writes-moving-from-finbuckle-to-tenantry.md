---
title: Writes after moving from Finbuckle.MultiTenant to Tenantry
description: The same Order entity and the same writes in one shared database, run against Finbuckle.MultiTenant 10.1.4 and Tenantry Core 0.7.0, with the SQL each one sends and the result.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry 0.7.0, Finbuckle.MultiTenant 10.1.4, .NET 10, EF Core 10.0.12 and SQLite
tags: [dotnet, efcore, multitenancy, aspnetcore]
next:
  label: Read the guide to migrating from Finbuckle
  href: /docs/core/migrating-from-finbuckle
draft: true
---

A team on Finbuckle.MultiTenant that looks at moving to [Tenantry Core](/docs/core) needs to know whether its data
ends up isolated the same way, as well as which methods to rename. I ran three writes against both libraries, with the
same `Order` entity, one shared SQLite database and two tenants, Acme and Globex, each with one order. Order 1 is
Acme's. Finbuckle.MultiTenant was 10.1.4, the current release; Tenantry was 0.7.0. Both ran on .NET 10 and EF Core
10.0.12.

The entity is the same in both runs, except that under Tenantry it implements `ITenantEntity<string>`:

```csharp
public class Order
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public decimal Total { get; set; }
    public string TenantId { get; set; } = null!;
}
```

## The two contexts

The Finbuckle context implements `IMultiTenantDbContext`, as Finbuckle's
[EF Core documentation](https://www.finbuckle.com/MultiTenant/Docs/v10.1.4/EFCore#configuring-and-using-a-shared-database)
describes. It calls `EnforceMultiTenantOnTracking()` in its constructor, which the same page
[recommends](https://www.finbuckle.com/MultiTenant/Docs/v10.1.4/EFCore#ef-core-tracking) so that `Add` and `Attach`
give an entity the current tenant's id:

```csharp
public class AppDbContext : DbContext, IMultiTenantDbContext
{
    public AppDbContext(IMultiTenantContextAccessor accessor, DbContextOptions<AppDbContext> options)
        : base(options)
    {
        TenantInfo = accessor.MultiTenantContext.TenantInfo;
        this.EnforceMultiTenantOnTracking();
    }

    public ITenantInfo? TenantInfo { get; }
    public TenantMismatchMode TenantMismatchMode => TenantMismatchMode.Throw;
    public TenantNotSetMode TenantNotSetMode => TenantNotSetMode.Throw;
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.Entity<Order>().IsMultiTenant();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        this.EnforceMultiTenant();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default)
    {
        this.EnforceMultiTenant();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
    }
}
```

`TenantMismatchMode.Throw` and `TenantNotSetMode.Throw` are Finbuckle's defaults, and what its `MultiTenantDbContext`
base class sets; a context that implements `IMultiTenantDbContext` itself has to declare both. Every Finbuckle result below is with these two modes unless it names another.

The Tenantry context loses the constructor parameter, the three properties, the model configuration and both
overrides:

```csharp
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
}
```

The isolation comes from one call where the context is registered:

```csharp
services.AddDbContext<AppDbContext>(options => options
    .UseSqlite(connection)
    .UseTenantry());
```

## An update that names another tenant's row

An endpoint that updates an order from the request body, without loading it first, runs this in Globex's request
with Acme's order id:

```csharp
// In Globex's context. Order 1 is Acme's.
db.Orders.Update(new Order { Id = 1, Reference = "A-1", Total = 0 });
await db.SaveChangesAsync();
```

Under Finbuckle, `EnforceMultiTenantOnTracking` gave the new instance Globex's `TenantId` when `Update` attached it,
`EnforceMultiTenant` found nothing to object to, and EF Core sent an `UPDATE` keyed by `Id` alone:

```sql
UPDATE "Orders" SET "Reference" = @p0, "TenantId" = @p1, "Total" = @p2 WHERE "Id" = @p3 RETURNING 1;
```

`SaveChangesAsync` returned 1. Acme's order now had a total of 0 and a `TenantId` of `globex`, so it had moved to
Globex. This happened under each of the three `TenantMismatchMode` values and both `TenantNotSetMode` values. Without
`EnforceMultiTenantOnTracking`, the instance has no tenant id and the save is refused, as the
[`TenantNotSetMode`](https://www.finbuckle.com/MultiTenant/Docs/v10.1.4/EFCore#tenant-not-set-mode) default, `Throw`,
says:

```text
Finbuckle.MultiTenant.Abstractions.MultiTenantException: 1 modified entities with Tenant Id not set.
```

With `TenantNotSetMode.Overwrite`, the same save went through and moved the row.

An instance that already carries `TenantId = "globex"`, because the request body or the calling code set it, passed
with or without `EnforceMultiTenantOnTracking` and moved the row in the same way, under every combination of the two
modes. One that carries another tenant's id, `TenantId = "acme"` in Globex's context, was refused under
`TenantMismatchMode.Throw`: `MultiTenantException: 1 modified entities with Tenant Id mismatch.` Under `Ignore` it was
saved as it was, so Globex's request changed Acme's order, and under `Overwrite` it was saved with Globex's id, which
moved the order to Globex. A Globex order loaded in Globex's context and given `TenantId = "acme"` was refused under
`Throw` in the same way; under `Ignore` it moved to Acme, and under `Overwrite` it stayed Globex's.

Under Tenantry, the instance without a tenant id was refused before anything was written:

```text
Tenantry.EfCore.TenantIsolationViolationException: Tenant isolation violation on entity 'Order': it belongs to
tenant '<null>' but the current tenant is 'globex'. SaveChanges was aborted before anything was written. Change an
entity only while its own tenant is current.
```

The instance carrying `TenantId = "globex"` passes that check, because its tenant is the current one. Tenantry makes
`TenantId` a concurrency token, so the stored tenant is part of the `WHERE` clause:

```sql
UPDATE "Orders" SET "Reference" = @p0, "TenantId" = @p1, "Total" = @p2 WHERE "Id" = @p3 AND "TenantId" = @p4 RETURNING 1;
```

The statement matched no row and EF Core threw `DbUpdateConcurrencyException` ("The database operation was expected
to affect 1 row(s), but actually affected 0 row(s)"). Acme's order kept its total of 100 and its tenant.

Loading the order before changing it avoids the problem under both libraries: `FindAsync(1)` in Globex's context
returned `null` under each.

## A read with no tenant

A query in a context with no current tenant, such as a background job that forgot to set one:

```csharp
var orders = await db.Orders.ToListAsync();
```

Finbuckle threw `System.NullReferenceException: Object reference not set to an instance of an object.` Its EF Core
page does not mention this case. Tenantry returned an empty list. Code or tests that relied on the
exception to find a missing tenant get no rows after the move, and no error.

Inserting with no tenant fails in both. Finbuckle threw `MultiTenantException: MultiTenant Entity cannot be attached
if TenantInfo is null.` under every combination of the two modes; without `EnforceMultiTenantOnTracking` the message
says "cannot be changed" instead. Tenantry threw `TenantNotResolvedException`.

## A bulk update that sets TenantId

```csharp
// In Acme's context.
var rows = await db.Orders.ExecuteUpdateAsync(s => s.SetProperty(o => o.TenantId, "globex"));
```

Finbuckle's query filter limited the statement to Acme's rows, and the statement moved them:

```sql
UPDATE "Orders" AS "o" SET "TenantId" = @p WHERE "o"."TenantId" = @ef_filter__Id
```

It returned 1 under every combination of the two modes, and Acme's order belonged to Globex. Tenantry checks the
setters when EF Core compiles the query, and threw before any SQL was sent:

```text
Tenantry.EfCore.TenantIsolationViolationException: ExecuteUpdate cannot set TenantId on tenant-owned entity 'Order':
that would move rows into another tenant. Set properties on the entity itself, and move data between tenants with
explicit, reviewed SQL.
```

## What Tenantry does not do

Tenantry adds `TenantId` to no key or index. Finbuckle's `AdjustUniqueIndexes()` and the other `Adjust` methods
([keys and indexes](https://www.finbuckle.com/MultiTenant/Docs/v10.1.4/EFCore#keys-and-indexes)) add it for you;
after the move you declare those indexes yourself, with their current names and columns, or the next migration drops
`TenantId` from them and a unique index becomes unique across every tenant.

Tenantry also builds in only an in-memory tenant store, so any other store becomes an `ITenantStore<TKey>` you
write. Finbuckle
[tries the next strategy](https://www.finbuckle.com/MultiTenant/Docs/v10.1.4/Strategies#using-multiple-strategies)
when no store knows an identifier; Tenantry uses the first identifier a resolver returns, and a request whose
identifier the store does not know has no tenant.

Neither library isolates SQL that does not start from a `DbSet`. In Acme's context, `Database.SqlQuery` over the
`Orders` table returned both tenants' rows under each library. `Orders.FromSql` returned only Acme's, because EF Core
composes query filters onto it. Tenantry's analyzer marks the `SqlQuery` call as TNY1003, at info level, which an IDE
shows on the call; `dotnet build` prints it only when `.editorconfig` raises it to a warning.

The guide below covers the rest of the move: tenant types and stores, resolvers and per-tenant options.
