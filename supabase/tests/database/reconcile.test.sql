-- customers_to_reconcile: everyone the reconcile run must check, as one array (not cut at max_rows).
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(3);

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

insert into public.active_subscriptions (customer_id, access_status, grace_ends_at) values
  ('ctm_access', 'grace', now() + interval '10 days'), ('ctm_lapsed', 'lapsed', null), ('ctm_vested', 'lapsed', null);
insert into public.active_subscriptions (customer_id, access_status, run_started_at, paid_through, vests_at) values
  ('ctm_running', 'lapsed', '2027-01-01', '2027-03-01', '2028-01-01');
insert into public.subscriptions (subscription_id, status, customer_id) values
  ('sub_past_due', 'past_due', 'ctm_past_due'), ('sub_lapsed', 'canceled', 'ctm_lapsed'),
  ('sub_vested', 'canceled', 'ctm_vested');
insert into public.licence_failures (customer_id, last_error) values ('ctm_failing', 'signing failed');
-- An annual term confirmed when paid: nothing about it changes with time, so it alone calls for no reconcile (its
-- payment's billing period does, below).
insert into public.vested_entitlements (
  customer_id, kind, started_at, vested_through, status, confirmed_at, transaction_id
) values ('ctm_annual', 'annual_term', '2027-01-01', '2028-01-01', 'confirmed', '2027-01-01', 'txn_annual');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_vested', 'paid_time', '2027-01-01', '2028-01-01', 'confirmed', '2028-01-01');
-- Every customer keeps their licence, so a licence alone does not call for a reconcile.
insert into public.licences (customer_id, jwt) values ('ctm_lapsed', 'jwt'), ('ctm_vested', 'jwt');

select is(
  (select count(*)::int from unnest(public.customers_to_reconcile()) id where id ~ '^ctm_[0-9]{4}$'),
  1500, 'every customer with an active subscription, past the 1000 rows an API query returns');
select ok(
  public.customers_to_reconcile()
    @> array['ctm_access', 'ctm_past_due', 'ctm_failing', 'ctm_running']
    and not public.customers_to_reconcile() && array['ctm_lapsed', 'ctm_vested', 'ctm_annual'],
  'found by access, a subscription that may entitle, a failing licence or a current run; a lapsed customer, vested '
    || 'or not, is not');

-- Paid time still being served: a payment kept in full counts for its whole period even after the subscription
-- ended, so vesting can fall due while the customer is lapsed. Visited until two days after the period ends.
insert into public.customers (customer_id, email) values
  ('ctm_paid_on', 'paid-on@example.com'), ('ctm_paid_off', 'paid-off@example.com');
insert into public.active_subscriptions (customer_id, access_status) values
  ('ctm_paid_on', 'lapsed'), ('ctm_paid_off', 'lapsed');
insert into public.payments (
  transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
  period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
) values
  ('txn_on', 'ctm_paid_on', 'sub_on', 'web', 'pri_1', 'month', 1, now() - interval '10 days',
    now() + interval '20 days', 3900, 0, 3900, 'GBP', now(), now()),
  ('txn_recent', 'ctm_paid_on', 'sub_on', 'web', 'pri_1', 'month', 1, now() - interval '40 days',
    now() - interval '10 days', 3900, 0, 3900, 'GBP', now(), now()),
  ('txn_off', 'ctm_paid_off', 'sub_off', 'web', 'pri_1', 'month', 1, now() - interval '33 days',
    now() - interval '3 days', 3900, 0, 3900, 'GBP', now(), now());
select ok(
  public.customers_to_reconcile() @> array['ctm_paid_on']
    and not public.customers_to_reconcile() @> array['ctm_paid_off'],
  'a lapsed customer is visited while a paid period is being served, and until two days after it ends');

select * from finish();
rollback;
