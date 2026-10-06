---
title: Shared database, database per tenant, or schema per tenant?
description: Where a multi-tenant EF Core application keeps each tenant's rows decides what a missed filter exposes, what a release migrates and what a backup restores. The three layouts, what each costs, and what Tenantry Core and Pro do for each.
date: 2026-10-06
author: Oliver McNally
versions: Tenantry 0.8, .NET 10, EF Core 10
tags: [dotnet, efcore, multitenancy, database]
next:
  label: See what Tenantry Pro includes
  href: /pro
draft: true
---

A multi-tenant application keeps its tenants' rows in one of three layouts: every tenant in the same tables of one
database, a database for each tenant, or a schema for each tenant in one database. The choice decides what a query
that forgets the tenant can read, how many databases a release migrates, what a backup restores, and what adding or
removing a tenant takes. It is hard to change later, because changing it means moving every tenant's data.

This post goes through what each layout costs, then what Tenantry does for each.
[Tenantry Core](/docs/core), which is free and open source, isolates tenants in a shared database and connects each
tenant to its own database. [Tenantry Pro](/pro), the paid subscription built on Core, adds a schema per tenant and
mixed mode, which gives different tenants different layouts.

## A shared database

Every tenant's rows are in the same tables, each row with the id of the tenant it belongs to. There is one database
to migrate, back up and monitor, and a new tenant is a row in the tenants table, so a tenant costs almost nothing to
add.

The isolation is in the application. Every query has to filter by the tenant, and every save has to stamp and check
it. In EF Core a global query filter covers the queries that start from a `DbSet`, but not SQL the application sends
through `Database`, or a query that calls `IgnoreQueryFilters()`. Anything that reads the database without EF Core,
such as a reporting tool, sees every tenant's rows unless the database enforces the tenant itself, with row-level
security.

The layout has other costs:

- A unique index on a column such as an order reference is unique across every tenant until the tenant's column is
  part of it.
- With `string` tenant ids, SQL Server's and MySQL's default collations ignore case, so tenants `acme` and `ACME`
  match each other's rows.
- One tenant's heavy reporting slows every other tenant's requests.
- A backup holds every tenant. Restoring one tenant's data means restoring the whole database elsewhere and copying
  that tenant's rows back.
- Removing a tenant means a `DELETE` from every table that holds its rows, in an order the foreign keys accept.

With Tenantry Core, an entity whose rows belong to a tenant implements `ITenantEntity<TKey>`, and one call on the
context's options adds the query filter and the checks on saves:

```csharp
public class Order : ITenantEntity<string>
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public string TenantId { get; set; } = null!;
}

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseNpgsql(builder.Configuration.GetConnectionString("App"))
    .UseTenantry());
```

Tenantry adds the tenant to no key or index, so a reference that is unique per tenant is declared with both columns:

```csharp
modelBuilder.Entity<Order>().HasIndex(o => new { o.TenantId, o.Reference }).IsUnique();
```

With no tenant current, a query matches nothing and a save to a tenant-owned entity throws. Tenantry's analyzers
report `IgnoreQueryFilters()` on a tenant-owned entity as a warning when the project builds, and mark SQL sent through
`Database` in the IDE. With `string` ids on SQL Server or MySQL, Tenantry logs a warning for `TenantId` columns that
use the database's default collation. SQL sent through `Database`, and anything that reaches the database without EF
Core, is not isolated ([what is and isn't isolated](/docs/core/efcore-integration#what-is-and-isnt-isolated)).

## A database per tenant

Each tenant has a database of its own, so a query that forgets the tenant still reads only that tenant's rows.
Backups, restores and deletion work per tenant: restoring one tenant is restoring its database, and removing one is
dropping it. A tenant that needs its own server or region can have its database there.

The cost is in the number of databases:

- Each database has a fixed cost, in money on services that charge per database, and in the server's memory and
  maintenance jobs.
- ADO.NET keeps a pool of connections for each connection string, so each instance of the application keeps
  connections open to every tenant database it served recently. Instances multiplied by active tenants can reach the
  server's connection limit.
- Every release migrates every database, and a new tenant needs its database created and migrated before its first
  request.
- A report across tenants has to query every database and combine the results.

With Tenantry Core, the application gives each tenant's connection string and registers the context with
`AddDbContextPerTenantDatabase`, pooled or not. The tenant resolution and access checks are as for a shared database
and are left out here:

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .UseStore<TenantStore>()
    .UseConnectionStrings(o => o.GetConnectionString = t => $"Host=db;Database=app_{t.TenantId};Username=app")
    .AddDbContextPerTenantDatabase<AppDbContext>((_, options) => options.UseNpgsql(), pooled: true));
```

Each context, or each lease of a pooled one, connects to the database of the tenant current when it is handed out.
Before EF Core opens a connection and before each command, Tenantry checks that the connection still belongs to the
current tenant, and throws if not. The query filter and the checks on saves still apply to entities that implement
`ITenantEntity<TKey>`.

Creating the databases and migrating them is left to the application. Core's guide has the loop that migrates every
tenant's database and the four things it leaves to you
([creating and migrating tenant databases](/docs/core/efcore-integration#creating-and-migrating-tenant-databases)).
Tenantry Pro creates a tenant's database when it is provisioned, migrates every tenant's database as a deployment step,
with a report of each failure, and drops a tenant's database when it leaves; the post on
[running EF Core migrations across tenant databases](/blog/running-ef-core-migrations-across-tenant-databases) shows
the migrations.

## A schema per tenant

All tenants share one database, and each has its own schema, with its own copy of every table: `tenant_acme.Orders`
and `tenant_globex.Orders`. There is one database to back up and one connection string, so one connection pool, and a
query that forgets the tenant reads only that tenant's schema. It works on SQL Server and PostgreSQL. MySQL has no
schemas apart from databases, so there it is a database per tenant.

It shares some costs with each of the other layouts:

- Every release migrates every schema, all on the same server, so a migration that rewrites a large table does so
  once per tenant on that one server.
- A backup still holds every tenant, so restoring one means restoring the database elsewhere and copying its schema
  back, which is simpler than picking its rows out of every table.
- EF Core builds a model for each schema, and compiles each query again for each schema's model. Its own cache holds
  the models of about 40 schemas, so with more tenants than that taking turns, models and queries are compiled again
  after each eviction.
- A context that gets the tenant's schema cannot be pooled, since a pooled context keeps the model it was built with.
- SQL the application writes itself, with `FromSql`, `SqlQuery` or `ExecuteSql`, runs as written, so a table name in
  it without a schema does not reach the tenant's table.

Schema per tenant is in Tenantry Pro. The context is registered against the one database, and names no schema:

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .UseStore<TenantStore>()
    .UsePro(pro => pro
        .UseSchemaPerTenant(o => o.GetSchemaName = t => $"tenant_{t.TenantId}")
        .AddSchemaProvisioning<AppDbContext>()
        .AddMigrations<AppDbContext>()));

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseNpgsql(builder.Configuration.GetConnectionString("App"))
    .UseTenantry());
```

Each context gets its tenant's schema as its default schema. Migrations are generated as usual, without a schema, and
each tenant's tables and migration history go into its own schema when they are applied. In place of EF Core's model
cache, each context type gets one with room for `MaxCachedSchemas` schemas, 500 by default. Provisioning a tenant
creates its schema and applies the migrations to it ([schema per tenant](/docs/pro/schema-per-tenant)).

## Different layouts for different tenants

Tenants are rarely the same size. Most may be small enough to share tables, while one large customer, or one whose
contract asks for it, needs a database of its own. Tenantry Pro's mixed mode gives each tenant its layout, from a
delegate that reads the tenant:

```csharp
static TenantIsolation IsolationOf(ITenantDescriptor<string> t) =>
    t.As<AppTenant>().DedicatedDatabase ? TenantIsolation.Database : TenantIsolation.Shared;

builder.Services.AddTenantry<string>(tenant => tenant
    .UseStore<TenantStore>()
    .UseConnectionStrings(o => o.GetConnectionString = t => IsolationOf(t) == TenantIsolation.Database
        ? $"Host=db;Database=app_{t.TenantId};Username=app"
        : "Host=db;Database=app;Username=app")
    .UsePro(pro => pro
        .UseMixedMode(o => o.GetIsolation = IsolationOf)
        .AddDatabaseProvisioning<AppDbContext>()
        .AddMigrations<AppDbContext>())
    .AddDbContextPerTenantDatabase<AppDbContext>((_, options) => options.UseNpgsql()));
```

`TenantIsolation` also has `Schema`, for a tenant with its own schema in the shared database, with
`UseSchemaPerTenant`. The delegate has to give a tenant the same answer every time, so it reads something fixed when
the tenant is created, such as `DedicatedDatabase` here, not something that changes, such as its plan. Moving a tenant
to another layout means moving its data, which Tenantry does not do.

In the shared database, the `Shared` tenants all read and write the rows of any entity that is not tenant-owned. So
every entity of a context those tenants use has to implement `ITenantEntity<TKey>`, or be marked as shared by every
tenant with `[SharedAcrossTenants]`. Pro refuses the context for a `Shared` tenant until each is one or the other
([mixed mode](/docs/pro/mixed-mode)).

## Choosing

- A shared database fits many small tenants, where adding a tenant has to cost nothing, and a backup that restores
  every tenant at once is acceptable.
- A database per tenant fits fewer, larger tenants, or tenants who need their data backed up, restored, placed or
  deleted on its own. Plan for creating and migrating every database from the start.
- A schema per tenant fits an application on SQL Server or PostgreSQL that wants each tenant's tables apart but one
  database to run, with a number of active tenants whose compiled models fit in memory.
- Mixed mode fits an application where most tenants share, and a few need a database or schema of their own.

## What Tenantry covers

- A shared database: Tenantry Core isolates it. Tenantry Pro adds deleting a tenant's rows from every tenant-owned
  table of a context when the tenant leaves.
- A database per tenant: Tenantry Core connects each context to its tenant's database and checks the connection
  before each command. Tenantry Pro creates, migrates and drops the databases, and checks their health.
- A schema per tenant, and mixed mode: Tenantry Pro.

With a shared database or a database per tenant, Core is enough to keep one tenant's data from another's. Pro adds
the two other layouts, and operations around tenants, such as creating, migrating and removing their databases and
schemas.
