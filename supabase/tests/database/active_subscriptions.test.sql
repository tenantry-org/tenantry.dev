-- set_customer_entitlement stores a customer's derived state (src/server/billing/entitlement-policy.ts computes it)
-- and returns the access status it replaced, which decides whether access starts or ends. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(27);

insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');
insert into public.payments (
  transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
  period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
) values
  ('txn_1', 'ctm_1', 'sub_1', 'web', 'pri_1', 'month', 1, '2027-01-01', '2027-02-01', 3900, 0, 3900, 'GBP', now(), now()),
  ('txn_2', 'ctm_1', 'sub_1', 'subscription_recurring', 'pri_1', 'month', 1, '2027-02-01', '2027-03-01', 3900, 0, 3900,
    'GBP', now(), now());

-- The state of a customer with two paid months, and one annual term that was refunded.
create temporary table run_state as select
  '{"access_status": "active", "run_started_at": "2027-01-01T00:00:00Z", "paid_through": "2027-03-01T00:00:00Z",
    "months_paid": 2, "vests_at": "2028-01-01T00:00:00Z"}'::jsonb as state,
  '[{"kind": "annual_term", "started_at": "2026-01-01T00:00:00Z", "vested_through": "2027-01-01T00:00:00Z",
     "status": "withdrawn", "confirmed_at": null, "transaction_id": "txn_0", "withdrawn_reason": "refund"}]'::jsonb
    as grants;

select is(
  public.set_customer_entitlement('ctm_1', (select state from run_state), (select grants from run_state),
    '{"txn_2": "refunded"}'),
  'lapsed', 'a customer seen for the first time had no access');
select results_eq(
  $$select access_status, run_started_at, paid_through, months_paid, vests_at
    from public.active_subscriptions where customer_id = 'ctm_1'$$,
  $$values ('active'::text, '2027-01-01 00:00+00'::timestamptz, '2027-03-01 00:00+00'::timestamptz, 2,
    '2028-01-01 00:00+00'::timestamptz)$$,
  'records the access and the paid time');
select results_eq(
  $$select kind, status, withdrawn_reason, transaction_id from public.vested_entitlements where customer_id = 'ctm_1'$$,
  $$values ('annual_term'::text, 'withdrawn'::text, 'refund'::text, 'txn_0'::text)$$,
  'records the grants');
select results_eq(
  $$select transaction_id, status from public.payments order by transaction_id$$,
  $$values ('txn_1'::text, 'paid'::text), ('txn_2'::text, 'refunded'::text)$$,
  'records each payment''s status');
select is(public.vested_through('ctm_1'), null, 'a withdrawn grant vests nothing');

-- An operator grant is kept through every recompute.
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at, note)
values ('ctm_1', 'operator', '2025-01-01', '2026-06-01', 'confirmed', now(), 'Merged from ctm_old');

-- A month later: the paid time vested; the refunded annual term is no longer computed (as if its payment were gone).
select is(
  public.set_customer_entitlement('ctm_1',
    '{"access_status": "grace", "grace_ends_at": "2028-03-02T00:00:00Z", "run_started_at": "2027-01-01T00:00:00Z",
      "paid_through": "2028-02-01T00:00:00Z", "months_paid": 13, "vests_at": "2028-01-01T00:00:00Z"}',
    '[{"kind": "paid_time", "started_at": "2027-01-01T00:00:00Z", "vested_through": "2028-02-01T00:00:00Z",
       "status": "confirmed", "confirmed_at": "2028-01-01T00:00:00Z", "transaction_id": null,
       "withdrawn_reason": null}]',
    '{}'),
  'active', 'returns the status it replaced');
select results_eq(
  $$select access_status, grace_ends_at, months_paid from public.active_subscriptions where customer_id = 'ctm_1'$$,
  $$values ('grace'::text, '2028-03-02 00:00+00'::timestamptz, 13)$$,
  'records the new state, with when grace ends');
select results_eq(
  $$select kind, status from public.vested_entitlements where customer_id = 'ctm_1' order by kind$$,
  $$values ('operator'::text, 'confirmed'::text), ('paid_time'::text, 'confirmed'::text)$$,
  'grants no longer computed are removed; the operator grant is kept');
select is(public.vested_through('ctm_1'), '2028-02-01 00:00+00'::timestamptz, 'vests through the latest confirmed grant');

-- An operator grant can only be added by hand: one in the computed grants is not stored.
select public.set_customer_entitlement('ctm_1',
  '{"access_status": "grace", "grace_ends_at": "2028-03-02T00:00:00Z"}',
  '[{"kind": "paid_time", "started_at": "2027-01-01T00:00:00Z", "vested_through": "2028-02-01T00:00:00Z",
     "status": "confirmed", "confirmed_at": "2028-01-01T00:00:00Z", "transaction_id": null, "withdrawn_reason": null},
    {"kind": "operator", "started_at": "2027-06-01T00:00:00Z", "vested_through": "2100-01-01T00:00:00Z",
     "status": "confirmed", "confirmed_at": "2027-06-01T00:00:00Z", "transaction_id": null, "withdrawn_reason": null}]',
  '{}');
select results_eq(
  $$select kind, vested_through from public.vested_entitlements where customer_id = 'ctm_1' order by kind$$,
  $$values ('operator'::text, '2026-06-01 00:00+00'::timestamptz),
    ('paid_time'::text, '2028-02-01 00:00+00'::timestamptz)$$,
  'stores no operator grant from the computed grants, and keeps the one added by hand');

-- The paid time's grant is confirmed again later, unchanged.
select is(
  public.set_customer_entitlement('ctm_1',
    '{"access_status": "lapsed"}',
    '[{"kind": "paid_time", "started_at": "2027-01-01T00:00:00Z", "vested_through": "2028-02-01T00:00:00Z",
       "status": "confirmed", "confirmed_at": "2028-01-01T00:00:00Z", "transaction_id": null,
       "withdrawn_reason": null}]',
    '{}'),
  'grace', 'ending access returns the entitled status');
select results_eq(
  $$select access_status, grace_ends_at, run_started_at, months_paid from public.active_subscriptions
    where customer_id = 'ctm_1'$$,
  $$values ('lapsed'::text, null::timestamptz, null::timestamptz, 0)$$,
  'ending access resets the grace end and the progress towards 12 paid months');
select is(public.vested_through('ctm_1'), '2028-02-01 00:00+00'::timestamptz, 'vested rights stay after a lapse');
select is(
  public.set_customer_entitlement('ctm_1', '{"access_status": "lapsed"}', null, null), 'lapsed',
  'a repeated end is not a change');

select throws_ok(
  $$select public.set_customer_entitlement('ctm_1', '{"access_status": "expired"}', null, null)$$,
  '23514', null, 'rejects an unknown access status');
select throws_ok(
  $$select public.set_customer_entitlement('ctm_1', '{"access_status": "grace"}', null, null)$$,
  '23514', null, 'rejects grace without when it ends');
select throws_ok(
  $$select public.set_customer_entitlement('ctm_1', '{"access_status": "active", "grace_ends_at": "2028-03-02T00:00:00Z"}',
    null, null)$$,
  '23514', null, 'rejects a grace end outside grace');
select throws_ok(
  $$select public.set_customer_entitlement('ctm_unknown', '{"access_status": "active"}', null, null)$$,
  '23503', null, 'rejects a customer that is not recorded');
select throws_ok(
  $$select public.set_customer_entitlement('ctm_1', '{"access_status": "active", "run_started_at": "2027-01-01T00:00:00Z"}',
    null, null)$$,
  '23514', null, 'rejects a paid time start without how far it is paid');
select throws_ok(
  $$select public.set_customer_entitlement('ctm_1', '{"access_status": "active"}',
    '[{"kind": "paid_time", "started_at": "2027-01-01T00:00:00Z", "vested_through": "2028-01-01T00:00:00Z",
       "status": "withdrawn", "confirmed_at": null, "transaction_id": null, "withdrawn_reason": null}]', null)$$,
  '23514', null, 'rejects a withdrawn grant without its reason');
select throws_ok(
  $$insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at)
    values ('ctm_1', 'operator', '2024-01-01', '2024-06-01', 'confirmed', now())$$,
  '23514', null, 'rejects an operator grant without a note');
select throws_ok(
  $$insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at)
    values ('ctm_1', 'annual_term', '2024-01-01', '2025-01-01', 'confirmed', '2024-01-01')$$,
  '23514', null, 'rejects an annual grant without its payment');
select throws_ok(
  $$insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, transaction_id)
    values ('ctm_1', 'annual_term', '2024-01-01', '2025-01-01', 'conditional', 'txn_0')$$,
  '23514', null, 'rejects a conditional grant: an annual term is confirmed when paid, or withdrawn');

select ok(
  has_function_privilege('service_role', 'public.set_customer_entitlement(text, jsonb, jsonb, jsonb)', 'execute'),
  'the service role can store a customer''s state');
select ok(
  not has_function_privilege('authenticated', 'public.set_customer_entitlement(text, jsonb, jsonb, jsonb)', 'execute'),
  'a signed-in user cannot');
select ok(
  not has_function_privilege('anon', 'public.set_customer_entitlement(text, jsonb, jsonb, jsonb)', 'execute'),
  'an anonymous user cannot');
select ok(
  has_function_privilege('service_role', 'public.vested_through(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.vested_through(text)', 'execute'),
  'only the service role reads a customer''s vested-through date this way');

select * from finish();
rollback;
