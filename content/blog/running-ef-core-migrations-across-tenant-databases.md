---
title: Running EF Core migrations across tenant databases
description: With a database per tenant, every release has to migrate every tenant's database. What a hand-written loop gets wrong, and how Tenantry Pro runs it as a deployment step.
date: 2026-10-03
updated: 2026-10-05
author: Oliver McNally
versions: Tenantry 0.7, .NET 10, EF Core 10 and PostgreSQL 16
tags: [dotnet, efcore, multitenancy, devops]
next:
  label: Read the tenant migrations guide
  href: /docs/pro/migration-orchestration
---

With one shared database, a release applies its EF Core migrations once, with `dotnet ef database update` or a
migration bundle. With a database or schema per tenant, it has to apply them to every tenant's database or schema, and
those tools update one database per run.

This post looks at what that takes, first by hand and then with the migration runner of [Tenantry Pro](/pro), the
paid subscription built on the free, open-source Tenantry Core.

## The loop most applications start with

Given Tenantry Core's tenant scopes, each of which connects the context to its tenant's database, the first version
is a loop at startup:

```csharp
foreach (var tenant in await tenants.GetAllTenantsAsync(ct))
{
    await using var scope = scopes.CreateScope(tenant);
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync(ct);
}
```

It works for a handful of tenants. Beyond that:

- A tenant whose database is unreachable, or whose data breaks a migration, throws and stops the loop. The
  application fails to start, with the tenants before it on the new schema and those after it on the old one.
  Catching the exception keeps the loop going, but then something has to record which databases failed and why.
- Every replica migrates every tenant at startup, so startup time grows with the number of tenants, and database load
  grows with tenants multiplied by replicas.
- Migrating the databases one after another is slow once there are hundreds, and migrating them all at once
  overwhelms the server.
- Nothing says which databases are behind, and by which migrations, without migrating them.
- New tenants need the same migrations, between creating their database and serving their first request.

## The same with Tenantry Pro

Tenantry Pro's runner applies your existing migrations to every tenant's database or schema. It is registered next to
the database-per-tenant setup that Tenantry Core already has:

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")
    .UseStore<TenantStore>()
    .UseConnectionStrings(o => o.GetConnectionString = t =>
        $"Host=db;Database=app_{t.TenantId};Username=app;Password={builder.Configuration["DbPassword"]}")
    .UsePro(pro => pro.AddMigrations<AppDbContext>(o => o.MaxConcurrency = 4))
    .AddDbContextPerTenantDatabase<AppDbContext>((_, options) => options.UseNpgsql()));
```

It creates each tenant's context in that tenant's scope, as a request does, so the context's connection string,
schema and interceptors are the ones your application uses.

### As a deployment step

Run it once per release, from one process, before the new version takes traffic: a CI/CD stage or a Kubernetes `Job`,
not an init container, which runs in every replica. Started with `migrate-tenants`, the application runs the
migrations and exits:

```csharp
await using var app = builder.Build();   // disposing it at exit writes out the last log messages
app.UseTenantry();                       // without it, the host refuses to start serving requests

// dotnet MyApp.dll migrate-tenants
if (await app.RunTenantMigrationsIfRequestedAsync(args) is { } exitCode)
    return exitCode;   // not 0 if any database failed, which fails the deployment step

await app.RunAsync();
return 0;
```

It is the same build you deploy, so the migrations, the tenant store and the connection strings are the release's
own. Each failure is logged once, as an error, and the run ends with a summary.

### What a run does with failures

A failure in one database never stops the others, unless `MaxFailures` says to stop, and the report says which failed
and why. EF Core applies only what is pending, so after fixing the cause the same command finishes the job. Tenants
that share a database or schema, such as the shared database in mixed mode, are migrated once and share one result.
Cancelling abandons the databases in progress and starts no more; those already migrated stay migrated.

From code, `ITenantMigrationRunner<TKey>` returns the report, and can report each database as it completes:

```csharp
var report = await migrations.MigrateAsync(
    progress: new Progress<MigrationResult<string>>(r => Console.WriteLine(
        $"{r.Database}: {(r.Succeeded ? $"{r.AppliedMigrations.Count} applied" : r.Error!.Message)}")),
    cancellationToken: ct);

Console.WriteLine($"{report.Succeeded} of {report.Total} databases migrated");
```

Each result names its tenants, its database and schema, its duration, the exception if it failed, and the migrations
added to its history during the run. A migration another process applied first is not counted, but when two runs
migrate the same database at once, a migration may be listed by either run, or by both.

### How many at once

By default the databases are migrated one at a time, so the database server is never flooded. `MaxConcurrency` (4
above) migrates several at once, which helps most when tenant databases are spread over several servers.

### Where things stand

The runner also reads the status without changing anything, and without a licence check:

```csharp
var status = await migrations.GetStatusAsync(cancellationToken: ct);
var behind = status
    .Where(entry => !entry.IsUpToDate)
    .Select(entry => $"{entry.Database}: {entry.Error?.Message ?? $"{entry.PendingMigrations.Count} pending"}");
```

A database that cannot be read gets an entry with its error rather than failing the whole call. Tenantry Pro's
migration health check reports the same, for your monitoring.

### New tenants

Provisioning a tenant runs the same migrations as one of its steps, after creating the database or schema and before
your own provisioning steps, such as seeding, so a new tenant starts on the current schema. See
[tenant lifecycle](/docs/pro/tenant-lifecycle).

### A schema per tenant

With a schema per tenant on SQL Server or PostgreSQL, migrations are generated as usual, without a schema, and each
tenant's tables, indexes, keys, sequences and migration history go into its own schema when they are applied.
SQL you add with `migrationBuilder.Sql(...)` is applied as written, so keep tenant migrations to EF Core's
operations.

## Limits

- Tenantry takes no lock of its own, so two runs at once both work through every tenant. EF Core 9 and later lock
  each database while migrating it, where the provider supports it, but with EF Core 8, or PostgreSQL with EF Core 10,
  two runs can race on the same migration. Run one at a time.
- The runner applies migrations and does not write them: generate them with `dotnet ef migrations add` as before.
- EF Core's `MigrateAsync` creates a database that does not exist, so in the loop above a wrong connection string gets
  a new, empty database. The runner does not: it reports that tenant's database as failed and migrates the others,
  and with a schema per tenant it does the same for a missing schema. Create tenant databases with provisioning, and
  set `CreateMissingDatabases` for development, where they do not exist yet.
- Migrations do not support Native AOT, here as in EF Core.

The [tenant migrations guide](/docs/pro/migration-orchestration) has the rest, including running at startup for a
single instance and the exact behaviour of each EF Core version and database.
