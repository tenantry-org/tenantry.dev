-- Two first publishes of one package id in two casings at once: the second waits for the first and is then refused,
-- rather than missing the first's uncommitted row and recording a second casing. A second connection (dblink) plays
-- the other publish, signing in with the local stack's default password, so it runs against the local database only:
-- `supabase test db supabase/local-tests` (CI runs it after supabase/tests). It is kept out of supabase/tests so that
-- `supabase test db --linked` against a hosted database runs every other test and passes.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(3);

-- The other publish's connection. It commits on its own, so the release it needs is committed there, and removed at
-- the end.
-- Over the network address this test is connected on (`supabase test db` connects over TCP): loopback connections are
-- trusted without a password, which dblink refuses.
select dblink_connect('race',
  'host=' || host(inet_server_addr()) || ' port=' || inet_server_port() || ' dbname=' || current_database()
    || ' user=postgres password=postgres');
select dblink_exec('race',
  $$insert into public.pro_releases (version, major, minor, patch, published_at)
    values ('77.0.0', 77, 0, 0, now()), ('77.0.1', 77, 0, 1, now())$$);

-- This publish records Tenantry.Pro.Race 77.0.0 first, and has not committed.
savepoint first_publish;
insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
values ('tenantry.pro.race', '77.0.0', 'Tenantry.Pro.Race', 'race/77.0.0/a.nupkg', 1, 'x', '<package/>');

-- The other records Tenantry.Pro.race 77.0.1 at the same time: no key of this one's conflicts with it.
select dblink_send_query('race',
  $$insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
    values ('tenantry.pro.race', '77.0.1', 'Tenantry.Pro.race', 'race/77.0.1/b.nupkg', 1, 'y', '<package/>')$$);
select pg_sleep(0.5);

select is(dblink_is_busy('race'), 1, 'the second casing waits for the first publish to finish');

-- Stop it, take this publish back (its row references the releases cleaned up below), and clean up whatever the
-- other connection committed, through a connection of its own.
select dblink_cancel_query('race');
select dblink_disconnect('race');
rollback to savepoint first_publish;
select dblink_connect('clean',
  'host=' || host(inet_server_addr()) || ' port=' || inet_server_port() || ' dbname=' || current_database()
    || ' user=postgres password=postgres');
select is(
  (select n from dblink('clean', $$select count(*) from public.pro_packages where lower_id = 'tenantry.pro.race'$$)
    as remote(n bigint)), 0::bigint,
  'the second casing was never recorded');
select dblink_exec('clean', $$delete from public.pro_packages where lower_id = 'tenantry.pro.race'$$);
select dblink_exec('clean', $$delete from public.pro_releases where version in ('77.0.0', '77.0.1')$$);
select is(
  (select n from dblink('clean', $$select count(*) from public.pro_releases where major = 77$$) as remote(n bigint)),
  0::bigint, 'the other connection left nothing behind');
select dblink_disconnect('clean');

select * from finish();
rollback;
