-- What 20261005170000_release_candidates.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after every
-- later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(5);

select results_eq(
  $$select version, rc, entitlement_at from public.pro_releases order by major, minor, patch$$,
  $$values ('0.7.0'::text, null::integer, '2026-09-20 12:00+00'::timestamptz), ('0.7.1', null, '2026-09-25 12:00+00'),
    ('0.7.2', null, '2026-09-20 12:00+00')$$,
  'existing releases stay releases, with their dates');
select is((select count(*)::int from public.pro_packages), 1, 'their packages are kept');
select lives_ok(
  $$insert into public.pro_releases (version, major, minor, patch, rc, published_at)
    values ('0.8.0-rc.1', 0, 8, 0, 1, '2026-10-05 12:00+00')$$,
  'a release candidate can be recorded');
update public.pro_releases set published_at = '2026-09-19 12:00+00' where version = '0.7.0';
select is((select entitlement_at from public.pro_releases where version = '0.7.2'), '2026-09-19 12:00+00'::timestamptz,
  'a corrected X.Y.0 release date still carries to its security patches');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at) values ('0.8', 0, 8, 0, now())$$,
  '23514', null, 'the version is still checked against its parts');

select * from finish();
rollback;
