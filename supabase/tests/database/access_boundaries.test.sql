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

select plan(33);

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
insert into public.subscriptions (subscription_id, subscription_status, customer_id) values
  ('sub_alice', 'active', 'ctm_alice'), ('sub_bob', 'active', 'ctm_bob');
insert into public.entitlements (customer_id, subscription_id, status) values
  ('ctm_alice', 'sub_alice', 'active'), ('ctm_bob', 'sub_bob', 'active');
insert into public.customer_access (customer_id, status) values ('ctm_alice', 'active'), ('ctm_bob', 'active');
insert into public.licences (customer_id, jwt, expires_at, revoked) values
  ('ctm_alice', 'alice-licence', now() + interval '1 year', false),
  ('ctm_bob', 'bob-licence', now() + interval '1 year', false),
  ('ctm_bob', 'bob-revoked-licence', now() + interval '1 year', true);
insert into public.github_links (customer_id, github_login, github_id) values
  ('ctm_alice', 'alice-gh', 1001), ('ctm_bob', 'bob-gh', 1002);
insert into public.licence_failures (customer_id, attempts, last_error) values ('ctm_bob', 1, 'signing failed');
insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload) values
  ('evt_bob', 'customer.updated', now(), 'ctm_bob', '{"data": {"email": "bob@example.com"}}');

-- As Alice.
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "role": "authenticated"}';

select results_eq($$select customer_id from public.customers$$, $$values ('ctm_alice'::text)$$,
  'Alice sees only her customer row');
select results_eq($$select subscription_id from public.subscriptions$$, $$values ('sub_alice'::text)$$,
  'only her subscription');
select results_eq($$select subscription_id from public.entitlements$$, $$values ('sub_alice'::text)$$,
  'only her entitlement');
select results_eq($$select customer_id from public.customer_access$$, $$values ('ctm_alice'::text)$$,
  'only her access');
select results_eq($$select jwt from public.licences$$, $$values ('alice-licence'::text)$$, 'only her licence');
select results_eq($$select github_login from public.github_links$$, $$values ('alice-gh'::text)$$,
  'only her GitHub link');
select is_empty($$select 1 from public.customers where customer_id = 'ctm_bob'$$,
  'asking for Bob''s customer by id returns nothing');
select is_empty($$select 1 from public.licences where customer_id = 'ctm_bob'$$,
  'asking for Bob''s licences by id returns nothing');
-- The service-only tables have row level security and no policy, so no row is visible to any user.
select is_empty($$select 1 from public.webhook_inbox$$, 'the webhook inbox shows no rows, not even her own events');
select is_empty($$select 1 from public.licence_failures$$, 'licence failures show no rows');

-- Alice cannot write, not even her own rows.
select throws_ok(
  $$insert into public.entitlements (customer_id, subscription_id, status) values ('ctm_alice', 'sub_bob', 'active')$$,
  '42501', null, 'she cannot grant herself an entitlement');
select throws_ok(
  $$insert into public.licences (customer_id, jwt, expires_at) values ('ctm_alice', 'forged', now() + interval '9 years')$$,
  '42501', null, 'she cannot add a licence');
select throws_ok(
  $$insert into public.github_links (customer_id, github_login, github_id) values ('ctm_bob', 'alice-gh', 1003)$$,
  '42501', null, 'she cannot link a GitHub account to another customer');
select results_eq(
  $$with changed as (update public.customer_access set status = 'active', github_state = 'active' returning 1)
    select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot change her access');
select results_eq(
  $$with changed as (update public.customers set email = 'bob@example.com' returning 1) select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot change her customer''s email to take over another account');
select results_eq(
  $$with changed as (update public.github_links set github_login = 'someone-else' returning 1)
    select count(*)::int from changed$$,
  $$values (0)$$, 'she cannot change her GitHub link');
select results_eq(
  $$with removed as (delete from public.licences returning 1) select count(*)::int from removed$$,
  $$values (0)$$, 'she cannot delete licences');
select throws_ok($$select public.set_customer_access('ctm_alice', 'active')$$, '42501', null,
  'she cannot call set_customer_access');
select throws_ok($$select public.record_customer_event('ctm_bob', 'alice@example.com', now())$$, '42501', null,
  'she cannot call record_customer_event to take over another customer');
select throws_ok($$select public.customers_to_reconcile()$$, '42501', null,
  'she cannot list the customers to reconcile');

-- As Bob, the other way round.
set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "role": "authenticated"}';

select results_eq($$select jwt from public.licences order by jwt$$,
  $$values ('bob-licence'::text), ('bob-revoked-licence'::text)$$, 'Bob sees only his licences');
select results_eq($$select github_login from public.github_links$$, $$values ('bob-gh'::text)$$,
  'and only his GitHub link');

-- Anonymous.
set local role postgres;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select is((select count(*)::int from public.customers), 0, 'anonymous: no customers');
select is((select count(*)::int from public.subscriptions), 0, 'anonymous: no subscriptions');
select is((select count(*)::int from public.entitlements), 0, 'anonymous: no entitlements');
select is((select count(*)::int from public.licences), 0, 'anonymous: no licences');
select is((select count(*)::int from public.github_links), 0, 'anonymous: no GitHub links');

-- Nothing the users tried changed anything.
set local role postgres;
select results_eq(
  $$select (select count(*)::int from public.entitlements where customer_id in ('ctm_alice', 'ctm_bob')),
      (select count(*)::int from public.licences where customer_id in ('ctm_alice', 'ctm_bob')),
      (select email from public.customers where customer_id = 'ctm_alice'),
      (select github_state from public.customer_access where customer_id = 'ctm_alice')$$,
  $$values (2, 3, 'alice@example.com'::text, 'none'::text)$$,
  'the rows are as the service role left them');

select * from finish();
rollback;
