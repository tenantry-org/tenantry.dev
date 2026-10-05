-- What 20261005180000_patches_take_their_minor_date.sql made of before.sql's rows. Run by scripts/test-migrations.sh,
-- after every later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(5);

select results_eq(
  $$select version, entitlement_at from public.pro_releases order by patch, rc nulls last$$,
  $$values ('0.8.0-rc.1'::text, '2026-11-01 12:00+00'::timestamptz), ('0.8.0', '2026-11-10 12:00+00'),
    ('0.8.1', '2026-11-10 12:00+00'), ('0.8.2', '2026-11-10 12:00+00'), ('0.8.3-rc.1', '2027-01-05 12:00+00')$$,
  'every patch release takes its X.Y.0 release''s date; candidates keep their own');
select results_eq(
  $$select version, published_at from public.pro_releases where version = '0.8.1'$$,
  $$values ('0.8.1'::text, '2026-12-01 12:00+00'::timestamptz)$$,
  'a patch release keeps its own publication date');
update public.pro_releases set published_at = '2026-11-09 12:00+00' where version = '0.8.0';
select results_eq(
  $$select version, entitlement_at from public.pro_releases where patch > 0 and rc is null order by patch$$,
  $$values ('0.8.1'::text, '2026-11-09 12:00+00'::timestamptz), ('0.8.2', '2026-11-09 12:00+00')$$,
  'a corrected X.Y.0 release date carries to every patch release');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at) values ('0.9.1', 0, 9, 1, now())$$,
  '23503', null, 'a patch release whose X.Y.0 release is not recorded is refused');
select hasnt_function('private', 'carry_release_date_to_security_patches', 'the security-only carry is gone');

select * from finish();
rollback;
