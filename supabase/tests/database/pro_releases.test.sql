-- pro_releases: each release's entitlement date, which a vested customer's vested-through date is compared with. A
-- security patch takes its minor's X.Y.0 date, so everyone vested on that minor can install the fix. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(11);

insert into public.pro_releases (version, major, minor, patch, published_at) values
  ('1.4.0', 1, 4, 0, '2027-11-20 12:00+00'),
  ('1.4.1', 1, 4, 1, '2027-12-10 12:00+00');
insert into public.pro_releases (version, major, minor, patch, published_at, security) values
  ('1.4.3', 1, 4, 3, '2028-03-15 12:00+00', true);

select is((select entitlement_at from public.pro_releases where version = '1.4.0'), '2027-11-20 12:00+00'::timestamptz,
  'a release is dated when it was published');
select is((select entitlement_at from public.pro_releases where version = '1.4.1'), '2027-12-10 12:00+00'::timestamptz,
  'so is an ordinary patch');
select is((select entitlement_at from public.pro_releases where version = '1.4.3'), '2027-11-20 12:00+00'::timestamptz,
  'a security patch takes its minor''s X.Y.0 date');

update public.pro_releases set published_at = '2027-11-21 12:00+00' where version = '1.4.3';
select is((select entitlement_at from public.pro_releases where version = '1.4.3'), '2027-11-20 12:00+00'::timestamptz,
  'and keeps it when its own date is corrected');

-- entitlement_at is derived: set directly, it is put back.
update public.pro_releases set entitlement_at = '2000-01-01 00:00+00' where version = '1.4.1';
select is((select entitlement_at from public.pro_releases where version = '1.4.1'), '2027-12-10 12:00+00'::timestamptz,
  'a release''s entitlement date cannot be set directly');
update public.pro_releases set entitlement_at = '2000-01-01 00:00+00' where version = '1.4.3';
select is((select entitlement_at from public.pro_releases where version = '1.4.3'), '2027-11-20 12:00+00'::timestamptz,
  'nor a security patch''s');

-- Correcting an X.Y.0's date moves its security patches with it, and not its other patches.
update public.pro_releases set published_at = '2027-11-19 08:00+00' where version = '1.4.0';
select results_eq(
  $$select version, entitlement_at from public.pro_releases where major = 1 and minor = 4 order by patch$$,
  $$values ('1.4.0'::text, '2027-11-19 08:00+00'::timestamptz), ('1.4.1', '2027-12-10 12:00+00'),
    ('1.4.3', '2027-11-19 08:00+00')$$,
  'a corrected X.Y.0 date carries to its security patches');

select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at, security)
    values ('1.5.1', 1, 5, 1, now(), true)$$,
  '23503', null, 'a security patch whose X.Y.0 is not recorded is refused');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at, security)
    values ('1.6.0', 1, 6, 0, now(), true)$$,
  '23514', null, 'an X.Y.0 cannot be a security patch');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.6', 1, 6, 0, now())$$,
  '23514', null, 'the version is major.minor.patch');

set local role authenticated;
select is_empty($$select 1 from public.pro_releases$$, 'signed-in users read no releases directly');
set local role postgres;

select * from finish();
rollback;
