-- The package feed's tables: feed tokens (created, limited to 10 live per customer, revoked, looked up by hash), the
-- packages of each release, and the download records. Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(31);

insert into public.customers (customer_id, email) values
  ('ctm_active', 'active@example.com'), ('ctm_vested', 'vested@example.com'), ('ctm_new', 'new@example.com');
insert into public.customers (customer_id, email) values ('ctm_grace', 'grace@example.com');
insert into public.active_subscriptions (customer_id, access_status) values
  ('ctm_active', 'active'), ('ctm_vested', 'lapsed');
insert into public.active_subscriptions (customer_id, access_status, grace_ends_at) values
  ('ctm_grace', 'grace', '2027-06-01 00:00+00');
insert into public.feed_tokens (customer_id, name, token_hash, prefix) values
  ('ctm_grace', 'CI', encode(sha256('tpf_grace'), 'hex'), 'tpf_grac');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_vested', 'paid_time', '2027-01-01', '2028-01-01', 'confirmed', '2028-01-01');

-- Hashes of made-up tokens.
create temporary table hashes as select
  encode(sha256('tpf_active'), 'hex') as active,
  encode(sha256('tpf_vested'), 'hex') as vested,
  encode(sha256('tpf_new'), 'hex') as new;

select isnt(
  public.create_feed_token('ctm_active', '  CI  ', (select active from hashes), 'tpf_acti'), null,
  'a token is created');
select is((select name from public.feed_tokens where customer_id = 'ctm_active'), 'CI', 'with its name trimmed');
select lives_ok(
  $$select public.create_feed_token('ctm_vested', 'Laptop', (select vested from hashes), 'tpf_vest')$$,
  'another customer''s token');
select lives_ok(
  $$select public.create_feed_token('ctm_new', 'Build', (select new from hashes), 'tpf_new_')$$,
  'a token for a customer whose access was never recorded');

select results_eq(
  $$select customer_id, access_status, vested_through from public.feed_customer((select active from hashes))$$,
  $$values ('ctm_active'::text, 'active'::text, null::timestamptz)$$,
  'a token gives its customer and their access');
select results_eq(
  $$select token_id from public.feed_customer((select active from hashes))$$,
  $$select id from public.feed_tokens where customer_id = 'ctm_active'$$,
  'and its own id, for the download records');
select results_eq(
  $$select customer_id, access_status, vested_through from public.feed_customer((select vested from hashes))$$,
  $$values ('ctm_vested'::text, 'lapsed'::text, '2028-01-01 00:00+00'::timestamptz)$$,
  'and their vested-through date');
select results_eq(
  $$select access_status, grace_ends_at from public.feed_customer(encode(sha256('tpf_grace'), 'hex'))$$,
  $$values ('grace'::text, '2027-06-01 00:00+00'::timestamptz)$$,
  'and, in grace, when it ends, for the feed to decide whether it has');
select results_eq(
  $$select access_status from public.feed_customer((select new from hashes))$$,
  $$values ('lapsed'::text)$$,
  'a customer with no recorded access has none');
select is_empty(
  $$select * from public.feed_customer(encode(sha256('tpf_unknown'), 'hex'))$$, 'an unknown token gives nothing');

select isnt((select last_used_at from public.feed_tokens where customer_id = 'ctm_active'), null, 'a use is recorded');
update public.feed_tokens set last_used_at = now() - interval '30 minutes' where customer_id = 'ctm_active';
select is((select count(*)::int from public.feed_customer((select active from hashes))), 1,
  'the token is used again within the hour');
select ok(
  (select last_used_at < now() - interval '29 minutes' from public.feed_tokens where customer_id = 'ctm_active'),
  'but at most once an hour');

select is(
  public.revoke_feed_token('ctm_vested', (select id from public.feed_tokens where customer_id = 'ctm_active')), false,
  'a customer cannot revoke another''s token');
select is(
  public.revoke_feed_token('ctm_active', (select id from public.feed_tokens where customer_id = 'ctm_active')), true,
  'a customer revokes their own');
select is_empty(
  $$select * from public.feed_customer((select active from hashes))$$, 'a revoked token gives nothing');
select is(
  public.revoke_feed_token('ctm_active', (select id from public.feed_tokens where customer_id = 'ctm_active')), false,
  'revoking it again changes nothing');

-- At most 10 live tokens; revoked ones do not count.
select lives_ok(
  $$select public.create_feed_token('ctm_active', 'token ' || n, encode(sha256(('tpf_' || n)::bytea), 'hex'), 'tpf_')
    from generate_series(1, 10) n$$,
  'ten live tokens, beside a revoked one');
select throws_ok(
  $$select public.create_feed_token('ctm_active', 'eleventh', encode(sha256('tpf_11'), 'hex'), 'tpf_')$$,
  '23514', null, 'an eleventh is refused');
select throws_ok(
  $$select public.create_feed_token('ctm_new', ' ', encode(sha256('tpf_blank'), 'hex'), 'tpf_')$$,
  '23514', null, 'a token needs a name');

-- Packages belong to a recorded release, under a Tenantry Pro id.
insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.4.0', 1, 4, 0, now());
select throws_ok(
  $$insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
    values ('other.package', '1.4.0', 'Other.Package', 'other/1.4.0/other.nupkg', 1, 'x', '<package/>')$$,
  '23514', null, 'only Tenantry Pro packages are recorded');

insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
values ('tenantry.pro.attack', '1.4.0', 'Tenantry.Pro.Attack', 'attack/1.4.0/a.nupkg', 1, 'x', '<package/>');
insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.4.1', 1, 4, 1, now());
select throws_ok(
  $$insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
    values ('tenantry.pro.attack', '1.4.1', 'Tenantry.Pro.attack', 'attack/1.4.1/a.nupkg', 1, 'x', '<package/>')$$,
  '23505', null, 'a package keeps the casing it was first recorded with');

select results_eq(
  $$select public from storage.buckets where id = 'pro-packages'$$, $$values (false)$$,
  'the packages'' bucket is private');

-- A download is recorded against a token and a recorded package, with the client's network, and goes with its token.
select lives_ok(
  $$insert into public.feed_downloads (token_id, lower_id, version, client_network)
    values ((select id from public.feed_tokens where customer_id = 'ctm_vested'), 'tenantry.pro.attack', '1.4.0',
      '192.0.2.0/24')$$,
  'a download is recorded');
select is(
  (select downloaded_at from public.feed_downloads), now(), 'at the time it is made');
select throws_ok(
  $$insert into public.feed_downloads (token_id, lower_id, version)
    values ((select id from public.feed_tokens where customer_id = 'ctm_vested'), 'tenantry.pro.attack', '9.9.9')$$,
  '23503', null, 'only of a recorded package');
select throws_ok(
  $$insert into public.feed_downloads (token_id, lower_id, version, client_network)
    values ((select id from public.feed_tokens where customer_id = 'ctm_vested'), 'tenantry.pro.attack', '1.4.0',
      '192.0.2.1/24')$$,
  '22P02', null, 'with a network, not an address');
delete from public.feed_tokens where customer_id = 'ctm_vested';
select is_empty($$select 1 from public.feed_downloads$$, 'a deleted token''s downloads are deleted with it');

-- An annual term paid yesterday, the subscription cancelled today with nothing refunded: stored as the site computes
-- it (entitlement-policy.ts), the term's grant is confirmed through its end, so the feed serves the releases of the
-- term, the one published now included. Its payment refunded or charged back, the grant is withdrawn.
insert into public.customers (customer_id, email) values ('ctm_annual', 'annual@example.com');
insert into public.feed_tokens (customer_id, name, token_hash, prefix) values
  ('ctm_annual', 'CI', encode(sha256('tpf_annual'), 'hex'), 'tpf_annu');
create temporary table annual_term as select
  date_trunc('second', now() - interval '1 day') as starts_at,
  date_trunc('second', now() - interval '1 day' + interval '1 year') as ends_at;
select public.set_customer_entitlement('ctm_annual', '{"access_status": "lapsed"}',
  jsonb_build_array(jsonb_build_object('kind', 'annual_term', 'started_at', (select starts_at from annual_term),
    'vested_through', (select ends_at from annual_term), 'status', 'confirmed',
    'confirmed_at', (select starts_at from annual_term), 'transaction_id', 'txn_year', 'withdrawn_reason', null)),
  '{}');
select results_eq(
  $$select access_status, vested_through from public.feed_customer(encode(sha256('tpf_annual'), 'hex'))$$,
  $$select 'lapsed'::text, ends_at from annual_term$$,
  'an annual term cancelled a day in is vested through its end');
select ok(
  (select entitlement_at from public.pro_releases where version = '1.4.1')
    <= (select vested_through from public.feed_customer(encode(sha256('tpf_annual'), 'hex'))),
  'so a release published in the term is covered');
select public.set_customer_entitlement('ctm_annual', '{"access_status": "lapsed"}',
  jsonb_build_array(jsonb_build_object('kind', 'annual_term', 'started_at', (select starts_at from annual_term),
    'vested_through', (select ends_at from annual_term), 'status', 'withdrawn', 'confirmed_at', null,
    'transaction_id', 'txn_year', 'withdrawn_reason', 'chargeback')),
  '{}');
select results_eq(
  $$select access_status, vested_through from public.feed_customer(encode(sha256('tpf_annual'), 'hex'))$$,
  $$values ('lapsed'::text, null::timestamptz)$$,
  'a chargeback of its payment withdraws it: nothing is vested');

select * from finish();
rollback;
