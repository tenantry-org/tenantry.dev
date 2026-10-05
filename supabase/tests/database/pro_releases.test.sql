-- pro_releases: each release's entitlement date, which a vested customer's vested-through date is compared with. Every
-- patch release, a security fix or not, takes its minor's X.Y.0 date, so everyone vested on that minor can install it. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(24);

insert into public.pro_releases (version, major, minor, patch, published_at) values
  ('1.4.0', 1, 4, 0, '2027-11-20 12:00+00'),
  ('1.4.1', 1, 4, 1, '2027-12-10 12:00+00');
insert into public.pro_releases (version, major, minor, patch, published_at, security) values
  ('1.4.3', 1, 4, 3, '2028-03-15 12:00+00', true);

select is((select entitlement_at from public.pro_releases where version = '1.4.0'), '2027-11-20 12:00+00'::timestamptz,
  'a release is dated when it was published');
select is((select entitlement_at from public.pro_releases where version = '1.4.1'), '2027-11-20 12:00+00'::timestamptz,
  'a patch release takes its minor''s X.Y.0 date');
select is((select entitlement_at from public.pro_releases where version = '1.4.3'), '2027-11-20 12:00+00'::timestamptz,
  'so does a security patch');

update public.pro_releases set published_at = '2027-11-21 12:00+00' where version = '1.4.3';
select is((select entitlement_at from public.pro_releases where version = '1.4.3'), '2027-11-20 12:00+00'::timestamptz,
  'and keeps it when its own date is corrected');

-- entitlement_at is derived: set directly, it is put back.
update public.pro_releases set entitlement_at = '2000-01-01 00:00+00' where version = '1.4.1';
select is((select entitlement_at from public.pro_releases where version = '1.4.1'), '2027-11-20 12:00+00'::timestamptz,
  'a release''s entitlement date cannot be set directly');
update public.pro_releases set entitlement_at = '2000-01-01 00:00+00' where version = '1.4.3';
select is((select entitlement_at from public.pro_releases where version = '1.4.3'), '2027-11-20 12:00+00'::timestamptz,
  'nor a security patch''s');

-- Correcting an X.Y.0's date moves every patch of it with it.
update public.pro_releases set published_at = '2027-11-19 08:00+00' where version = '1.4.0';
select results_eq(
  $$select version, entitlement_at from public.pro_releases where major = 1 and minor = 4 order by patch$$,
  $$values ('1.4.0'::text, '2027-11-19 08:00+00'::timestamptz), ('1.4.1', '2027-11-19 08:00+00'),
    ('1.4.3', '2027-11-19 08:00+00')$$,
  'a corrected X.Y.0 date carries to its patches');

select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at, security)
    values ('1.5.1', 1, 5, 1, now(), true)$$,
  '23503', null, 'a security patch whose X.Y.0 is not recorded is refused');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.5.2', 1, 5, 2, now())$$,
  '23503', null, 'and so is any other patch release');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at, security)
    values ('1.6.0', 1, 6, 0, now(), true)$$,
  '23514', null, 'an X.Y.0 cannot be a security patch');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.6', 1, 6, 0, now())$$,
  '23514', null, 'the version is major.minor.patch');

-- Release candidates: X.Y.Z-rc.N, dated when published, never as their minor; a patch never takes a candidate's date.
insert into public.pro_releases (version, major, minor, patch, rc, published_at) values
  ('1.7.0-rc.1', 1, 7, 0, 1, '2028-04-01 12:00+00'),
  ('1.7.0-rc.2', 1, 7, 0, 2, '2028-04-10 12:00+00');
select is((select entitlement_at from public.pro_releases where version = '1.7.0-rc.2'),
  '2028-04-10 12:00+00'::timestamptz, 'a release candidate is dated when it was published');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at, security)
    values ('1.7.1', 1, 7, 1, now(), true)$$,
  '23503', null, 'a security patch whose minor has only candidates is refused: it needs the X.Y.0 release');
insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.7.0', 1, 7, 0, '2028-04-20 12:00+00');
insert into public.pro_releases (version, major, minor, patch, published_at, security) values
  ('1.7.1', 1, 7, 1, '2028-05-01 12:00+00', true);
select is((select entitlement_at from public.pro_releases where version = '1.7.1'), '2028-04-20 12:00+00'::timestamptz,
  'a security patch takes the X.Y.0 release''s date, not a candidate''s');
update public.pro_releases set published_at = '2028-04-02 12:00+00' where version = '1.7.0-rc.1';
select is((select entitlement_at from public.pro_releases where version = '1.7.1'), '2028-04-20 12:00+00'::timestamptz,
  'and a corrected candidate date does not carry to it');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, rc, published_at, security)
    values ('1.7.2-rc.1', 1, 7, 2, 1, now(), true)$$,
  '23514', null, 'a release candidate cannot be a security patch');
insert into public.pro_releases (version, major, minor, patch, rc, published_at) values
  ('1.7.2-rc.1', 1, 7, 2, 1, '2028-05-10 12:00+00');
select is((select entitlement_at from public.pro_releases where version = '1.7.2-rc.1'),
  '2028-05-10 12:00+00'::timestamptz, 'a candidate of a patch is dated when it was published, not as its minor');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, rc, published_at) values ('1.8.0-rc.0', 1, 8, 0, 0, now())$$,
  '23514', null, 'candidates are numbered from 1');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, rc, published_at) values ('1.8.0', 1, 8, 0, 1, now())$$,
  '23514', null, 'a candidate''s version carries its number');
select throws_ok(
  $$insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.8.0-beta.1', 1, 8, 0, now())$$,
  '23514', null, 'no other prerelease label');

-- 0.8.0 in January, 0.9.0 in March, then 0.8.3 in June. A customer vested through February (0.8.0 vested) is covered
-- for 0.8.3, published after that date, and not for 0.9.0; one vested through December 2026 is covered for neither.
insert into public.pro_releases (version, major, minor, patch, published_at) values
  ('0.8.0', 0, 8, 0, '2027-01-10 12:00+00'), ('0.9.0', 0, 9, 0, '2027-03-10 12:00+00'),
  ('0.8.3', 0, 8, 3, '2027-06-10 12:00+00');
select is((select entitlement_at from public.pro_releases where version = '0.8.3'), '2027-01-10 12:00+00'::timestamptz,
  'a patch published months later is dated as its minor''s X.Y.0');
select results_eq(
  $$select version from public.pro_releases
    where major = 0 and entitlement_at <= '2027-02-01 00:00+00' order by minor, patch$$,
  $$values ('0.8.0'::text), ('0.8.3')$$,
  'vested through February: 0.8.0 and 0.8.3, not 0.9.0');
select is_empty(
  $$select version from public.pro_releases where major = 0 and entitlement_at <= '2026-12-01 00:00+00'$$,
  'vested through December 2026: not 0.8.3, since 0.8.0 is not vested');

set local role authenticated;
select is_empty($$select 1 from public.pro_releases$$, 'signed-in users read no releases directly');
set local role postgres;

select * from finish();
rollback;
