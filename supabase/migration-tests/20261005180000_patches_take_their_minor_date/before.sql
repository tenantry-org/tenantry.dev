-- Rows as the schema after 20261005170000_release_candidates.sql held them, loaded before
-- 20261005180000_patches_take_their_minor_date.sql runs: a minor's X.Y.0 release, a candidate of it, an ordinary patch
-- (then dated when published), a security patch (dated as the X.Y.0) and a candidate of a patch.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.pro_releases (version, major, minor, patch, rc, published_at) values
  ('0.8.0-rc.1', 0, 8, 0, 1, '2026-11-01 12:00+00'),
  ('0.8.0', 0, 8, 0, null, '2026-11-10 12:00+00'),
  ('0.8.1', 0, 8, 1, null, '2026-12-01 12:00+00'),
  ('0.8.3-rc.1', 0, 8, 3, 1, '2027-01-05 12:00+00');
insert into public.pro_releases (version, major, minor, patch, published_at, security) values
  ('0.8.2', 0, 8, 2, '2026-12-15 12:00+00', true);

select results_eq(
  $$select version, entitlement_at from public.pro_releases where version in ('0.8.1', '0.8.2') order by patch$$,
  $$values ('0.8.1'::text, '2026-12-01 12:00+00'::timestamptz), ('0.8.2', '2026-11-10 12:00+00')$$,
  'before: only the security patch is dated as its minor');

select * from finish();
