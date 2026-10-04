---
title: Running EF Core migrations across tenant databases
description: With a database per tenant, every release has to migrate every tenant's database. What a hand-written loop gets wrong, and how Tenantry Pro runs it as a deployment step.
date: 2026-10-03
author: Oliver McNally
versions: Tenantry 0.6, .NET 10 and EF Core 10
tags: [dotnet, efcore, multitenancy, devops]
next:
  label: Read the tenant migrations guide
  href: /docs/pro/migration-orchestration
---

With one database for everyone, a release applies its EF Core migrations once, with `dotnet ef database update` or a
migration bundle. With a database for each tenant, or a schema for each, the same release has to apply them to every
tenant's database, and `dotnet ef database update` updates one database at a time.

This post looks at what that takes, first by hand and then with Tenantry Pro's migration runner.

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

It works for a handful of tenants, and then:

- **One failure stops the rest.** A tenant whose database is unreachable, or whose data breaks a migration, throws,
  and the application fails to start, with the tenants before it on the new schema and those after it on the old one.
  Catching the exception keeps the loop going, but then something has to record which databases failed and why.
- **It runs on every instance.** At startup, each replica migrates every tenant, so each one's startup grows with the
  number of tenants, and the load on your databases with tenants times replicas.
- **It takes as long as all the databases together.** Migrating them one after another is slow once there are
  hundreds; migrating them all at once overwhelms the server.
- **It cannot tell you where things stand** without migrating: which databases are behind, and by which migrations.
- **New tenants need it too**, between creating their database and serving their first request.

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

The recommended way to run it is once per release, from one process, before the new version takes traffic: a CI/CD
stage or a Kubernetes `Job`. (An init container runs in every replica, which is the case to avoid.) The application
runs the migrations and exits when it is started with `migrate-tenants`:

```csharp
await using var app = builder.Build();   // disposing it at exit writes out the last log messages

// dotnet MyApp.dll migrate-tenants
if (await app.RunTenantMigrationsIfRequestedAsync(args) is { } exitCode)
    return exitCode;   // 1 if any database failed, which fails the deployment step

await app.RunAsync();
return 0;
```

It is the same build you deploy, so the migrations, the tenant store and the connection strings are the release's
own. Each failure is logged once, as an error, and the run ends with a summary. A non-zero exit code stops the
pipeline before the new version starts.

### What a run does with failures

- **Each database is on its own.** A failure in one never stops the others. The run goes on, and the report says which
  databases failed and why.
- **A rerun picks up where it stopped.** EF Core applies only what is pending, so after fixing the cause the same
  command finishes the job.
- **Tenants that share a database or schema are migrated once**, together, and share one result: the shared database
  in mixed mode, say.
- **Cancelling stops it.** Databases in progress are abandoned, the rest are not started, and those already migrated
  stay migrated.

From code, `ITenantMigrationRunner<TKey>` returns the report, and can report each database as it completes:

```csharp
var report = await migrations.MigrateAllAsync(
    new Progress<MigrationResult<string>>(r => Console.WriteLine(
        $"{r.Database}: {(r.Succeeded ? $"{r.AppliedMigrations.Count} applied" : r.Error!.Message)}")),
    ct);

Console.WriteLine($"{report.Succeeded} of {report.Total} databases migrated");
```

Each result names its tenants, its database and schema, the migrations this run applied, its duration and, if it
failed, the exception. "Applied" means applied by this run: a migration another process applied first is not counted.

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
your seeders, so a new tenant starts on the current schema. See [tenant lifecycle](/docs/pro/tenant-lifecycle).

### A schema per tenant

With a schema per tenant on SQL Server or PostgreSQL, migrations are generated as usual, without a schema, and each
tenant's tables, indexes, keys, sequences and migration history go into its own schema when they are applied.
SQL you add with `migrationBuilder.Sql(...)` is applied as written, so keep tenant migrations to EF Core's
operations.

## Limits

- **There is no lock across instances.** EF Core 9 and later lock a database while migrating it, on providers that
  support it, but two runs at once still both work through every tenant, and with EF Core 8, or PostgreSQL with
  EF Core 10, they can race on the same migration. Run it once, as a deployment step, rather than at startup on every replica.
- **It applies migrations; it does not write them.** Generate them with `dotnet ef migrations add` as before.
- **A run does not create a missing database.** EF Core's `MigrateAsync` creates a database that does not exist, so
  in the loop above a wrong connection string gets a new, empty database. The runner reports that tenant's database
  as failed and migrates the others; with a schema per tenant, the same goes for a missing schema. Create tenant
  databases with provisioning, and set `CreateMissingDatabases` for development, where they do not exist yet.
- **Migrations are not Native AOT compatible**, here as in EF Core.

The [tenant migrations guide](/docs/pro/migration-orchestration) has the rest, including running at startup for a
single instance and the exact behaviour of each EF Core version and database.
