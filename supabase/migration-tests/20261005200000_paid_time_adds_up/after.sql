-- What 20261005200000_paid_time_adds_up.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after every
-- later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(5);

select results_eq(
  $$select customer_id, kind, vested_through from public.vested_entitlements$$,
  $$values ('ctm_vested'::text, 'paid_time'::text, '2026-01-01 00:00+00'::timestamptz)$$,
  'a qualifying period''s grant is now the paid time''s, with its date until the recompute');
select is(public.vested_through('ctm_vested'), '2026-01-01 00:00+00'::timestamptz, 'so the customer stays vested');
select results_eq(
  $$select customer_id, kind, status from public.customer_jobs where id like '%_paid_time_adds_up' order by customer_id$$,
  $$values ('ctm_gap'::text, 'reconcile'::text, 'pending'::text), ('ctm_vested', 'reconcile', 'pending')$$,
  'every customer with a payment is queued for a recompute under the new rule, and no other');
select throws_ok(
  $$insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at)
    values ('ctm_gap', 'qualifying_run', '2024-06-01', '2026-02-01', 'confirmed', now())$$,
  '23514', null, 'qualifying_run is no longer a kind');
select lives_ok(
  $$select public.set_customer_entitlement('ctm_gap', '{"access_status": "lapsed"}',
    '[{"kind": "paid_time", "started_at": "2024-06-01T00:00:00Z", "vested_through": "2026-02-01T00:00:00Z",
       "status": "confirmed", "confirmed_at": "2026-02-01T00:00:00Z", "transaction_id": null,
       "withdrawn_reason": null}]', '{}')$$,
  'set_customer_entitlement stores a paid-time grant');

select * from finish();
rollback;
