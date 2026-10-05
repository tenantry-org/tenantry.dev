-- Rows as the schema after 20261005190000_withdrawn_reasons.sql held them, loaded before
-- 20261005200000_paid_time_adds_up.sql runs: a customer vested by a qualifying period, one with six paid months either
-- side of a gap (not vested under the old rule), and one with no payment.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_vested', 'vested@example.com'), ('ctm_gap', 'gap@example.com'), ('ctm_none', 'none@example.com');
insert into public.payments (
  transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
  period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
) values
  ('txn_vested', 'ctm_vested', 'sub_vested', 'web', 'pri_month', 'month', 1, '2025-12-01', '2026-01-01', 3900, 0, 3900,
    'GBP', '2025-12-01', '2025-12-01'),
  ('txn_gap_1', 'ctm_gap', 'sub_gap_1', 'web', 'pri_month', 'month', 1, '2024-06-01', '2024-07-01', 3900, 0, 3900,
    'GBP', '2024-06-01', '2024-06-01'),
  ('txn_gap_2', 'ctm_gap', 'sub_gap_2', 'web', 'pri_month', 'month', 1, '2026-01-01', '2026-02-01', 3900, 0, 3900,
    'GBP', '2026-01-01', '2026-01-01');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_vested', 'qualifying_run', '2025-01-01', '2026-01-01', 'confirmed', '2026-01-01');

select is((select count(*)::int from public.vested_entitlements), 1, 'one qualifying period recorded');

select * from finish();
