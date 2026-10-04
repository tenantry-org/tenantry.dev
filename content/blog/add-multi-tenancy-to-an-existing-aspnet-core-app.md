---
title: Add multi-tenancy to an existing ASP.NET Core application
description: Keep your organisations table as the tenant registry, resolve the tenant on each request, and isolate EF Core data with one call on the DbContext you already have.
date: 2026-10-03
author: Oliver McNally
versions: Tenantry 0.6, .NET 10, EF Core 10 and PostgreSQL 16
tags: [dotnet, aspnetcore, efcore, multitenancy]
next:
  label: Get started with Tenantry Core
  href: /docs/core/getting-started
---

This post adds tenant isolation to an ASP.NET Core application whose tables already carry an `OrganisationId`, so
that no query depends on remembering a `WHERE` clause. It uses [Tenantry Core](/docs/core), the open-source part of
Tenantry. The organisations table stays the tenant registry, the tenant comes from the request, and EF Core applies it
to every query and save. The context stays the one you have.

## The starting point

An ASP.NET Core API over EF Core and PostgreSQL. Organisations are the customers, and each order belongs to one:

```csharp
public class Organisation
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";      // acme, as in acme.example.com
    public bool IsActive { get; set; } = true;
}

public class Order
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public decimal Total { get; set; }
    public Guid OrganisationId { get; set; }
    public Organisation? Organisation { get; set; }
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<Order> Orders => Set<Order>();
}
```

Add the two packages:

```bash
dotnet add package Tenantry.AspNetCore
dotnet add package Tenantry.EfCore
```

## 1. The organisations table is the tenant registry

Tenantry has no tenants table of its own. You write a store over the table you have: it finds a tenant by id and
lists them all. When requests name a tenant by a slug or a domain, also implement `FindByIdentifierAsync`.

```csharp
public sealed record OrganisationTenant(Guid TenantId, string Name, bool IsActive) : ITenantDescriptor<Guid>;

public sealed class OrganisationTenantStore(AppDbContext db) : ITenantStore<Guid>
{
    public async ValueTask<ITenantDescriptor<Guid>?> GetTenantAsync(Guid tenantId, CancellationToken ct = default) =>
        await db.Organisations.AsNoTracking()
            .Where(o => o.Id == tenantId)
            .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive))
            .SingleOrDefaultAsync(ct);

    public async ValueTask<IReadOnlyList<ITenantDescriptor<Guid>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        await db.Organisations.AsNoTracking()
            .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive))
            .ToListAsync<ITenantDescriptor<Guid>>(ct);

    // Requests name an organisation by its subdomain: acme.example.com.
    public async ValueTask<ITenantDescriptor<Guid>?> FindByIdentifierAsync(string identifier, CancellationToken ct = default) =>
        await db.Organisations.AsNoTracking()
            .Where(o => o.Slug == identifier)
            .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive))
            .SingleOrDefaultAsync(ct);
}
```

The store only reads: creating and changing organisations stays in your code. It lists inactive organisations too,
because tools that work through every tenant, such as migrations, need them. The next step decides whether one may be
used. `Organisation` is not tenant-owned, so the store's queries are not filtered.

## 2. Resolve the tenant, and check that the caller may use it

```csharp
builder.Services.AddTenantry<Guid>(tenant => tenant
    .ResolveFromSubdomain(o => o.BaseDomains.Add("example.com"))   // acme.example.com → acme
    .UseStore<OrganisationTenantStore>()
    .CacheTenants()                                                 // five minutes by default
    .RequireTenantByDefault()
    .ValidateTenantAccessByClaim("org_id")                          // the caller belongs to it
    .ValidateTenantActivity(t => t.As<OrganisationTenant>().IsActive));
```

```csharp
app.UseAuthentication();
app.UseTenantry();
app.UseAuthorization();
```

Anyone can type a subdomain, so two checks run before the organisation becomes current. `ValidateTenantActivity`
refuses a deactivated organisation, and `ValidateTenantAccessByClaim` refuses a user whose `org_id` claims do not
include the organisation's id. Either refusal is answered with `403`, the same as for an organisation that does not
exist, so users cannot find out which others do. A request with no organisation gets `400`, unless its endpoint calls
`AllowMissingTenant()`. `UseTenantry()` goes after `UseAuthentication()`, because the claim check reads the user.

With `CacheTenants`, a deactivated organisation is served from the cache until its entry expires; call
`ITenantInvalidator<Guid>.InvalidateAsync` when you deactivate one.

## 3. Mark the tenant-owned entities

An entity is tenant-owned when it implements `ITenantEntity<Guid>`, whose one member is `TenantId`. Orders already
have that column, `OrganisationId`, so rename the property and keep the column and the relationship:

```csharp
public class Order : ITenantEntity<Guid>
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public decimal Total { get; set; }
    public Guid TenantId { get; private set; }               // was OrganisationId
    public Organisation? Organisation { get; private set; }
}
```

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Order>(order =>
    {
        order.Property(o => o.TenantId).HasColumnName("OrganisationId");
        order.HasOne(o => o.Organisation).WithMany().HasForeignKey(o => o.TenantId);
    });
}
```

No table changes and no data moves: your next migration changes only the model snapshot. The setter can be private,
because Tenantry sets `TenantId` on insert, and the compiler then finds the code that used to set `OrganisationId` by
hand.

## 4. One call on the context

```csharp
builder.Services.AddDbContext<AppDbContext>(options => options
    .UseNpgsql(builder.Configuration.GetConnectionString("App"))
    .UseTenantry());
```

`AppDbContext` is still a plain `DbContext`: no base class, no interface and no `SaveChanges` override. With
`AddDbContextPool` the call is the same, and a pooled context reads the tenant each time it is used rather than when it
was created.

## What it does now

I ran the following against PostgreSQL 16, with two organisations, Acme and Globex.

In Acme's requests, `db.Orders.ToListAsync()` returns Acme's orders, and `FindAsync` with
the id of a Globex order returns `null`, so an endpoint that loads before it changes answers `404`. With no tenant, a
query matches nothing rather than everything.

An insert is stamped with the current tenant. One that names another tenant throws
`TenantIsolationViolationException`, and one with no tenant at all throws `TenantNotResolvedException`; nothing is
written either way.

Updates and deletes are checked twice. First, the entity's `TenantId`, as it was loaded or attached and as it is now,
must be the current tenant's. A new instance built from a request body has no tenant, so it is refused, whichever
organisation the order belongs to:

```csharp
// Refused: a new instance has no tenant, so SaveChanges throws TenantIsolationViolationException.
db.Orders.Update(new Order { Id = id, Reference = input.Reference, Total = input.Total });

// Load it as the current tenant, then change it: Globex's order is not found in Acme's request.
var order = await db.Orders.FindAsync(id);
if (order is null) return Results.NotFound();
order.Reference = input.Reference;
```

The second check is in the SQL. `TenantId` is a concurrency token, so the stored tenant is part of every `UPDATE` and
`DELETE`:

```sql
UPDATE "Orders" SET "Total" = @p0 WHERE "Id" = @p1 AND "OrganisationId" = @p2;
```

An entity that pairs Globex's order id with Acme's tenant id, the forged case, passes the first check and matches no
row: EF Core throws `DbUpdateConcurrencyException`, and Globex's order is unchanged.

`ExecuteUpdate` and `ExecuteDelete` are filtered in the same way, and an `ExecuteUpdate` may not set `TenantId`.

## What it does not do

The isolation is in EF Core, not in the database:

- Raw SQL (`FromSql`, `SqlQuery`, `ExecuteSql`) is not seen. Add the tenant to it yourself.
- `IgnoreQueryFilters()` turns the tenant filter off for that query, for administrators' reports. On EF Core 10,
  `IgnoreQueryFilters([TenantryQueryFilters.Tenant])` keeps your other filters.
- A context whose options do not call `UseTenantry()` is not isolated.
- Anything that reaches the database directly is not checked. If that matters, add row-level security in the
  database, or give each tenant a database of its own.

The [EF Core guide](/docs/core/efcore-integration#what-is-and-isnt-isolated) lists every case.

## Background work

A job or a queue consumer has no subdomain. Open a scope for the organisation instead, with an injected
`ITenantScopeFactory<Guid>`:

```csharp
await scopes.RunInScopeAsync(message.OrganisationId, async (scope, ct) =>
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    // Filtered and stamped for this organisation, as in a request.
}, cancellationToken);
```

`RunInScopeAsync` applies the `ValidateTenantActivity` check as a request does: for a deactivated organisation it
throws `TenantInactiveException` and the work does not run. The claim check needs a request, so it does not run here,
and `CreateScope` checks neither.

## From here

The same store and resolution work with a database per tenant: `UseConnectionStrings` gives each organisation its
connection string, and `AddDbContextPerTenantDatabase` connects each context to it, pooled if you like. Tenant keys
can be `int` or `string` as well as `Guid`. The [`SecureApi` sample](https://github.com/tenantry-org/tenantry-core/tree/master/samples/Tenantry.Samples.SecureApi)
puts this together with JWT authentication and integration tests.
