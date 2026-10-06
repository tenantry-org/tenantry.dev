---
title: Deleting one tenant's data from a shared EF Core database
description: Offboarding a tenant whose rows sit in many tables of a shared database, with foreign keys between them. What Tenantry Pro's offboarding deleted, refused and reported, and what it leaves to you.
date: 2026-10-04
author: Oliver McNally
versions: Tenantry 0.8, .NET 10, EF Core 10.0.12 and SQLite
tags: [dotnet, efcore, multitenancy, database]
next:
  label: See what Tenantry Pro includes
  href: /pro
draft: true
---

When a customer leaves, or asks for its data to be erased, its rows in a shared database are spread over every
tenant-owned table, with foreign keys between them. Deleting them means a `DELETE` per table, in an order the foreign
keys accept, in one transaction. This post does it by hand, then offboards the same tenant with
[Tenantry Pro](/pro), the paid subscription built on the free, open-source Tenantry Core, and shows what happened to
its rows and to the other tenant's.

The database is SQLite, with two tenants, Acme and Globex. Each has one customer, three orders and six order lines.
`Order` references `Customer`, and `OrderLine` references `Order`, both with `DeleteBehavior.Restrict`, so the database
refuses to delete a row that another still references. All three implement `ITenantEntity<string>`.

The code below leaves that model out: `Order` has a `CustomerId` and `Lines`, `OrderLine` an `OrderId`, and
`OnModelCreating` sets both foreign keys with `OnDelete(DeleteBehavior.Restrict)`. `AppTenant` is a tenant descriptor
with a settable `IsActive`, and `acme` and `globex` are its two instances. `scopes` is an `ITenantScopeFactory<string>`,
`deprovisioner` an `ITenantDeprovisioner<string>`, `ct` a `CancellationToken` and `connectionString` the SQLite file's.

## By hand

Tenantry Core does not delete a tenant's rows, but in the tenant's scope each `ExecuteDelete` is filtered to that
tenant, so the deletion is a few lines:

```csharp
await using (var scope = scopes.CreateScope(globex))
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    await db.OrderLines.ExecuteDeleteAsync(ct);
    await db.Orders.ExecuteDeleteAsync(ct);
    await db.Customers.ExecuteDeleteAsync(ct);
    await transaction.CommitAsync(ct);
}
```

```sql
DELETE FROM "OrderLines" AS "o" WHERE @ef_filter__p2 AND "o"."TenantId" = @ef_filter__p1
DELETE FROM "Orders" AS "o" WHERE @ef_filter__p2 AND "o"."TenantId" = @ef_filter__p1
DELETE FROM "Customers" AS "c" WHERE @ef_filter__p2 AND "c"."TenantId" = @ef_filter__p1
```

It deleted Globex's rows and left Acme's. Globex was already suspended, so the code uses `CreateScope`, which checks
nothing; `RunInScopeAsync` refuses a suspended tenant. The tables and their order are written out by hand, so a
tenant-owned table added later is left behind until someone adds it here. An export before the deletion, and clearing
the tenant's caches after it, are more code of your own.

## With Tenantry Pro

```csharp
services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString).UseTenantry());

services.AddTenantry<string>(tenant => tenant
    .UseInMemoryStore([acme, globex])
    .ValidateTenantActivity(t => t.As<AppTenant>().IsActive)
    .UsePro(pro => pro
        .AddDeprovisioningStep<ExportTenantData>()
        .AddSharedDataDeletion<AppDbContext>()));
```

`AddDeprovisioningStep` adds a step of your own, here an export. `AddSharedDataDeletion` adds the step that deletes
the tenant's rows from every tenant-owned table of `AppDbContext`. Offboarding invalidates the tenant, runs your steps,
then the deletion, then invalidates the tenant again
([Offboarding a tenant](/docs/pro/tenant-lifecycle#offboarding-a-tenant) has the details).

The export step is resolved in the tenant's scope, so its context reads that tenant's rows only:

```csharp
public sealed class ExportTenantData(AppDbContext db) : ITenantDeprovisioningStep<string>
{
    public async Task ExecuteAsync(TenantDeprovisioningContext<string> context, CancellationToken ct)
    {
        // The tenant's scope: the context sees this tenant's rows only.
        var orders = await db.Orders.Include(o => o.Lines).AsNoTracking().ToListAsync(ct);

        // A new file each run: a run after the rows are gone must not replace the export.
        var file = Path.Combine(ExportFolder, $"{context.Tenant.TenantId}-{DateTime.UtcNow:yyyyMMdd-HHmmssfff}.json");
        await File.WriteAllTextAsync(file, JsonSerializer.Serialize(orders), ct);
        Console.WriteLine($"  export: {orders.Count} orders of {context.Tenant.TenantId} written to {Path.GetFileName(file)}");
    }

    public static string ExportFolder { get; } = Path.Combine(AppContext.BaseDirectory, "exports");
}
```

## An active tenant is refused

```csharp
var result = await deprovisioner.DeprovisionAsync(globex);
```

Called while Globex was active, it ran nothing and threw:

```text
System.InvalidOperationException: Tenant 'globex' was not offboarded: the tenant store has it and it is active, so
requests and background work can still run for it. Suspend it first, so a ValidateTenantActivity validator refuses
it, or remove it from the store.
```

Then I set Globex's `IsActive` to `false`, the flag `ValidateTenantActivity` reads.

## A failed step stops the rest

On the first attempt the export folder did not exist. The result reported each step:

```text
Succeeded: False
ExportTenantData   Failed    DirectoryNotFoundException: Could not find a part of the path '…/exports/globex-20261005-034038184.json'.
DeleteSharedData   NotRun
ClearCaches        NotRun
```

No row was deleted. A failed export never lets the deletion run.

## The deletion

With the folder created, I called `DeprovisionAsync` again. The export wrote Globex's three orders, and the deletion
sent one statement per table, order lines first and customers last, in one transaction:

```sql
DELETE FROM "OrderLines" WHERE "TenantId" = @tenantId
DELETE FROM "Orders" WHERE "TenantId" = @tenantId
DELETE FROM "Customers" WHERE "TenantId" = @tenantId
```

```text
info: Tenantry.Pro.EfCore.Internal.DeleteSharedDataStep[4007] Tenantry.Pro: deleted 10 row(s) of tenant 'globex' from 3 table(s) of AppDbContext
Succeeded: True
ExportTenantData   Succeeded
DeleteSharedData   Succeeded
ClearCaches        Succeeded
```

Afterwards the tables held Acme's one customer, three orders and six lines, and nothing of Globex's.

Running it a third time succeeded too: the deletion found 0 rows. The export ran again and found no orders. Had it
written to a fixed file name, it would have replaced the real export with an empty one; with a new name per run, the
folder kept both, of 535 and 2 bytes. Tenantry does not tell a step that the shared rows are already gone.

Removing Globex from the tenant store comes after a successful result, and is the application's job: the store is
yours.

## What it refuses, and what it leaves

The deletion looks only at tenant-owned tables. A row of another table that references a tenant's row is left to the
database's foreign key. I added a `Referrals` table, shared by every tenant, with a foreign key to `Customers` and one
row pointing at Globex's customer. With `ON DELETE RESTRICT` (`DeleteBehavior.Restrict`), the delete from `Customers`
failed, and the transaction was rolled back:

```text
DeleteSharedData   Failed    SqliteException: SQLite Error 19: 'FOREIGN KEY constraint failed'.
ClearCaches        NotRun
```

Every Globex row was still there, and so was the referral. `NO ACTION` (`DeleteBehavior.NoAction`) failed in the same
way. With `ON DELETE CASCADE` the step succeeded and the referral was deleted with the customer, and with `SET NULL` it
succeeded and the referral stayed, its `CustomerId` cleared.

Tenant-owned tables that reference each other in a cycle fail the step too. With `Customers` and `Addresses` pointing
at each other, it failed before sending any SQL:

```text
DeleteSharedData   Failed    InvalidOperationException: The tenant's rows were not deleted: the tables Addresses,
Customers reference each other in a cycle, which no order of DELETE statements can remove. Delete them in a
deprovisioning step of your own.
```

Other rows in tables without a `TenantId` stay, and so does anything outside the database, such as uploaded files or a
search index. Each needs a deprovisioning step of your own, added before the deletion.

Offboarding invalidates the tenant through `ITenantInvalidator<TKey>` before its first step, before it checks that the
tenant is suspended, and the last step, `ClearCaches`, invalidates it again. Invalidating clears the caches of the
instance that runs it. With Tenantry Core's `BroadcastInvalidations`, it is also published to the application's other
instances; without it, they keep their cached copies until those expire. I added a handler with
`BroadcastInvalidations` that printed each invalidation, which the registration above leaves out: Globex was
invalidated once in each refused or failed offboarding, and twice in each that succeeded.
