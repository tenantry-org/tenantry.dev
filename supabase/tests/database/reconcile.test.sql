-- customers_to_reconcile: everyone the reconcile run must check, as one array (not cut at max_rows).
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(2);

insert into public.customers (customer_id, email)
select 'ctm_' || lpad(n::text, 4, '0'), 'buyer' || n || '@example.com' from generate_series(1, 1500) n;
insert into public.customers (customer_id, email) values
  ('ctm_access', 'access@example.com'), ('ctm_past_due', 'past-due@example.com'),
  ('ctm_failing', 'failing@example.com'),
  ('ctm_running', 'running@example.com'), ('ctm_annual', 'annual@example.com'),
  ('ctm_lapsed', 'lapsed@example.com'), ('ctm_vested', 'vested@example.com');

-- 1500 customers with an active subscription, more than the API's max_rows.
insert into public.subscriptions (subscription_id, status, customer_id)
select 'sub_' || customer_id, 'active', customer_id from public.customers where customer_id ~ '^ctm_[0-9]+$';

insert into public.active_subscriptions (customer_id, access_status) values
  ('ctm_access', 'grace'), ('ctm_lapsed', 'lapsed'), ('ctm_vested', 'lapsed');
insert into public.active_subscriptions (customer_id, access_status, run_started_at, paid_through, vests_at) values
  ('ctm_running', 'lapsed', '2027-01-01', '2027-03-01', '2028-01-01');
insert into public.subscriptions (subscription_id, status, customer_id) values
  ('sub_past_due', 'past_due', 'ctm_past_due'), ('sub_lapsed', 'canceled', 'ctm_lapsed'),
  ('sub_vested', 'canceled', 'ctm_vested');
insert into public.licence_failures (customer_id, last_error) values ('ctm_failing', 'signing failed');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, transaction_id) values
  ('ctm_annual', 'annual_term', '2027-01-01', '2028-01-01', 'conditional', 'txn_annual');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_vested', 'qualifying_run', '2027-01-01', '2028-01-01', 'confirmed', '2028-01-01');
-- Every customer keeps their licence, so a licence alone does not call for a reconcile.
insert into public.licences (customer_id, jwt) values ('ctm_lapsed', 'jwt'), ('ctm_vested', 'jwt');

select is(
  (select count(*)::int from unnest(public.customers_to_reconcile()) id where id ~ '^ctm_[0-9]{4}$'),
  1500, 'every customer with an active subscription, past the 1000 rows an API query returns');
select ok(
  public.customers_to_reconcile()
    @> array['ctm_access', 'ctm_past_due', 'ctm_failing', 'ctm_running', 'ctm_annual']
    and not public.customers_to_reconcile() && array['ctm_lapsed', 'ctm_vested'],
  'found by access, a subscription that may entitle, a failing licence, a current run or an annual '
    || 'grant to confirm; a lapsed customer, vested or not, is not');

select * from finish();
rollback;
