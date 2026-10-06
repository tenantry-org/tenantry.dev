-- The database's access boundary for signed-in and anonymous users: two customers never see each other's
-- rows, nobody but the service role writes, the service-only tables and functions are out of reach, and
-- every table (including ones added later) has row level security with read-only policies.
-- Run with `supabase test db` against the local database, or `supabase test db --linked` against a hosted one.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(50);

-- Structure: holds for every table and function, not only the ones listed below.
select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity$$,
  'every public table has row level security');
select is_empty(
  $$select tablename || ' ' || cmd from pg_policies where schemaname = 'public' and cmd <> 'SELECT'$$,
  'no policy lets a user write: only the service role (which bypasses RLS) writes');
select is_empty(
  $$select tablename from pg_policies where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles))$$,
  'no policy applies to anonymous users');
select is_empty(
  $$select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and p.proname <> 'confirmed_email'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))$$,
  'no security definer function but confirmed_email can be called by a user');
select ok(
  not has_function_privilege('anon', 'private.confirmed_email()', 'execute'),
  'anonymous users cannot call confirmed_email');

-- Two confirmed buyers, each with a full set of rows.
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@example.com', now(), 'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@example.com', now(), 'authenticated', 'authenticated');
insert into public.customers (customer_id, email) values
  ('ctm_alice', 'alice@example.com'), ('ctm_bob', 'bob@example.com');
insert into public.subscriptions (subscription_id, status, customer_id) values
  ('sub_alice', 'active', 'ctm_alice'), ('sub_bob', 'active', 'ctm_bob');
insert into public.active_subscriptions (customer_id, access_status) values
  ('ctm_alice', 'active'), ('ctm_bob', 'active');
insert into public.licences (customer_id, jwt) values
  ('ctm_alice', 'alice-licence'),
  ('ctm_bob', 'bob-licence'),
  ('ctm_bob', 'bob-second-licence');
insert into public.payments (
  transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
  period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
) values
  ('txn_alice', 'ctm_alice', 'sub_alice', 'web', 'pri_1', 'month', 1, '2027-01-01', '2027-02-01', 3900, 0, 3900, 'GBP',
    now(), now()),
  ('txn_bob', 'ctm_bob', 'sub_bob', 'web', 'pri_1', 'month', 1, '2027-01-01', '2027-02-01', 3900, 0, 3900, 'GBP',
    now(), now());
insert into public.payment_adjustments (adjustment_id, transaction_id, customer_id, action, type, status, last_event_at)
values ('adj_alice', 'txn_alice', 'ctm_alice', 'refund', 'partial', 'approved', now());
insert into public.offered_prices (price_id) values ('pri_1');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_alice', 'paid_time', '2026-01-01', '2027-01-01', 'confirmed', now()),
  ('ctm_bob', 'paid_time', '2026-01-01', '2027-01-01', 'confirmed', now());
insert into public.pro_releases (version, major, minor, patch, published_at) values ('1.0.0', 1, 0, 0, now());
insert into public.pro_packages (lower_id, version, package_id, storage_path, size, sha512, nuspec)
values ('tenantry.pro', '1.0.0', 'Tenantry.Pro', 'tenantry.pro/1.0.0/tenantry.pro.1.0.0.nupkg', 1, 'x', '<package/>');
insert into public.feed_tokens (customer_id, name, token_hash, prefix) values
  ('ctm_alice', 'CI', encode(sha256('tpf_alice'), 'hex'), 'tpf_alic'),
  ('ctm_bob', 'CI', encode(sha256('tpf_bob'), 'hex'), 'tpf_bob_');
insert into public.feed_downloads (token_id, lower_id, version, client_network)
select id, 'tenantry.pro', '1.0.0', '192.0.2.0/24' from public.feed_tokens;
insert into public.licence_failures (customer_id, attempts, last_error) values ('ctm_bob', 1, 'signing failed');
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload) values
  ('evt_bob', 'paddle_event', 'ctm_bob', now(), 'customer.updated', '{"data": {"email": "bob@example.com"}}');

-- As Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "role": "authenticated"}';

select results_eq($$select customer_id from public.customers$$, $$values ('ctm_alice'::text)$$,
  'Alice sees only her customer row');
select results_eq($$select subscription_id from public.subscriptions$$, $$values ('sub_alice'::text)$$,
  'only her subscription');
select results_eq($$select customer_id from public.active_subscriptions$$, $$values ('ctm_alice'::text)$$,
  'only her access');
select results_eq($$select transaction_id from public.payments$$, $$values ('txn_alice'::text)$$, 'only her payments');
select results_eq($$select customer_id from public.vested_entitlements$$, $$values ('ctm_alice'::text)$$,
  'only her vested entitlement');
select results_eq($$select jwt from public.licences$$, $$values ('alice-licence'::text)$$, 'only her licence');
select is_empty($$select 1 from public.customers where customer_id = 'ctm_bob'$$,
  'asking for Bob''s customer by id returns nothing');
select is_empty($$select 1 from public.licences where customer_id = 'ctm_bob'$$,
  'asking for Bob''s licences by id returns nothing');
-- The service-only tables have row level security and no policy, so no row is visible to any user.
select is_empty($$select 1 from public.customer_jobs$$, 'customer jobs show no rows, not even her own');
select is_empty($$select 1 from public.licence_failures$$, 'licence failures show no rows');
select is_empty($$select 1 from public.payment_adjustments$$, 'payment adjustments show no rows');
select is_empty($$select 1 from public.pro_releases$$, 'releases show no rows');
select is_empty($$select 1 from public.pro_packages$$, 'packages show no rows');
select throws_ok($$select 1 from public.feed_downloads$$, '42501', null,
  'download records cannot be read, not even her own');
select results_eq($$select id is not null, name, prefix from public.feed_tokens$$, $$values (true, 'CI'::text, 'tpf_alic'::text)$$,
  'only her feed tokens');
select throws_ok($$select token_hash from public.feed_tokens$$, '42501', null, 'without their hashes');
select throws_ok($$select * from public.feed_tokens$$, '42501', null, 'not even by asking for every column');
select throws_ok($$select public.create_feed_token('ctm_alice', 'mine', repeat('b', 64), 'tpf_')$$, '42501', null,
  'she cannot create a feed token herself');
select throws_ok(
  $$select public.revoke_feed_token('ctm_bob', (select id from public.feed_tokens limit 1))$$, '42501', null,
  'nor revoke one');
select throws_ok(
  $$insert into public.feed_tokens (customer_id, name, token_hash, prefix) values ('ctm_alice', 'x', repeat('c', 64), 'tpf_')$$,
  '42501', null, 'nor insert one');
select throws_ok(
  $$delete from public.feed_downloads$$, '42501', null, 'nor delete download records');
select throws_ok($$select * from public.feed_customer(encode(sha256('tpf_bob'), 'hex'))$$, '42501', null,
  'she cannot look up a feed token');
select results_eq(
  $$with changed as (update public.feed_tokens set revoked_at = null returning 1) select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot change a feed token');

-- Alice cannot write, not even her own rows.
select throws_ok(
  $$insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at, note)
    values ('ctm_alice', 'operator', now(), now() + interval '10 years', 'confirmed', now(), 'mine')$$,
  '42501', null, 'she cannot grant herself a vested entitlement');
select throws_ok(
  $$insert into public.payments (
      transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
      period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at)
    values ('txn_forged', 'ctm_alice', 'sub_alice', 'web', 'pri_1', 'year', 1, now(), now() + interval '1 year', 1, 0,
      1, 'GBP', now(), now())$$,
  '42501', null, 'she cannot record a payment');
select is((select count(*)::int from public.offered_prices), 0, 'she cannot see the offered prices');
select throws_ok(
  $$insert into public.offered_prices (price_id) values ('pri_mine')$$,
  '42501', null, 'she cannot add a price that would count towards vesting');
select throws_ok(
  $$insert into public.licences (customer_id, jwt) values ('ctm_alice', 'forged')$$,
  '42501', null, 'she cannot add a licence');
select results_eq(
  $$with changed as (update public.active_subscriptions set access_status = 'active', months_paid = 12 returning 1)
    select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot change her access');
select results_eq(
  $$with changed as (update public.vested_entitlements set vested_through = now() + interval '10 years' returning 1)
    select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot extend her vested entitlement');
select results_eq(
  $$with changed as (update public.customers set email = 'bob@example.com' returning 1) select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot change her customer''s email to take over another account');
select results_eq(
  $$with changed as (update public.customers set is_test = true returning 1) select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot mark herself a test customer');
select results_eq(
  $$with removed as (delete from public.licences returning 1) select count(*)::int from removed$$,
  $$values (0)$$, 'she cannot delete licences');
select throws_ok($$select public.set_customer_entitlement('ctm_alice', '{"access_status": "active"}', null, null)$$,
  '42501', null, 'she cannot call set_customer_entitlement');
select throws_ok($$select public.vested_through('ctm_bob')$$, '42501', null,
  'she cannot read another customer''s vested-through date');
select throws_ok($$select public.record_customer_event('ctm_bob', 'alice@example.com', now())$$, '42501', null,
  'she cannot call record_customer_event to take over another customer');
select throws_ok($$select public.customers_to_reconcile()$$, '42501', null,
  'she cannot list the customers to reconcile');

-- As Bob, the other way round.
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "role": "authenticated"}';

select results_eq($$select jwt from public.licences order by jwt$$,
  $$values ('bob-licence'::text), ('bob-second-licence'::text)$$, 'Bob sees only his licences');

-- Anonymous.
set local role postgres;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select is((select count(*)::int from public.customers), 0, 'anonymous: no customers');
select is((select count(*)::int from public.subscriptions), 0, 'anonymous: no subscriptions');
select is((select count(*)::int from public.active_subscriptions), 0, 'anonymous: no access');
select is((select count(*)::int from public.payments), 0, 'anonymous: no payments');
select is((select count(*)::int from public.vested_entitlements), 0, 'anonymous: no vested entitlements');
select is((select count(*)::int from public.licences), 0, 'anonymous: no licences');

-- Nothing the users tried changed anything.
set local role postgres;
select results_eq(
  $$select (select count(*)::int from public.vested_entitlements where customer_id in ('ctm_alice', 'ctm_bob')),
      (select count(*)::int from public.payments where customer_id in ('ctm_alice', 'ctm_bob')),
      (select count(*)::int from public.licences where customer_id in ('ctm_alice', 'ctm_bob')),
      (select email from public.customers where customer_id = 'ctm_alice'),
      (select months_paid from public.active_subscriptions where customer_id = 'ctm_alice'),
      (select max(vested_through) from public.vested_entitlements where customer_id = 'ctm_alice')$$,
  $$values (2, 2, 3, 'alice@example.com'::text, 0, '2027-01-01 00:00+00'::timestamptz)$$,
  'the rows are as the service role left them');

select * from finish();
rollback;
