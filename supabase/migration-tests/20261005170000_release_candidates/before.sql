-- Rows as the schema after 20261005160000_annual_term_vests_when_paid.sql held them, loaded before
-- 20261005170000_release_candidates.sql runs: a minor's X.Y.0, an ordinary patch and a security patch, with a package.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.pro_releases (version, major, minor, patch, published_at) values
  ('0.8.0', 0, 8, 0, '2026-09-20 12:00+00'),
  ('0.8.1', 0, 8, 1, '2026-09-25 12:00+00');
insert into public.pro_releases (version, major, minor, patch, published_at, security) values
  ('0.8.2', 0, 8, 2, '2026-10-01 12:00+00', true);
insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
values ('tenantry.pro', '0.8.0', 'Tenantry.Pro', 'tenantry.pro/0.8.0/p.nupkg', 1, 'x', '<package/>');

select is((select entitlement_at from public.pro_releases where version = '0.8.2'), '2026-09-20 12:00+00'::timestamptz,
  'the security patch is dated as its minor');

select * from finish();
