-- Rows as the schema after 20261005150000_offered_prices.sql held them, loaded before
-- 20261005160000_annual_term_vests_when_paid.sql runs: an annual term kept so far (conditional), one completed
-- (confirmed), one refunded (withdrawn), and two still conditional whose payments have had money returned (a refund, and
-- a chargeback later reversed) or are not recorded; and a customer whose state names a term waiting to be confirmed.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_paying', 'paying@example.com'), ('ctm_done', 'done@example.com'), ('ctm_refunded', 'refunded@example.com'),
  ('ctm_returned', 'returned@example.com'), ('ctm_disputed', 'disputed@example.com'),
  ('ctm_unrecorded', 'unrecorded@example.com');
insert into public.payments (
  transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
  period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
) values
  ('txn_paying', 'ctm_paying', 'sub_paying', 'web', 'pri_year', 'year', 1, '2026-10-01', '2027-10-01', 39000, 0,
    39000, 'GBP', '2026-10-01', '2026-10-01'),
  ('txn_returned', 'ctm_returned', 'sub_returned', 'web', 'pri_year', 'year', 1, '2026-10-01', '2027-10-01', 39000, 0,
    39000, 'GBP', '2026-10-01', '2026-10-01'),
  ('txn_disputed', 'ctm_disputed', 'sub_disputed', 'web', 'pri_year', 'year', 1, '2026-10-01', '2027-10-01', 39000, 0,
    39000, 'GBP', '2026-10-01', '2026-10-01');
insert into public.payment_adjustments (
  adjustment_id, transaction_id, customer_id, action, type, item_types, status, approved_at, reversed_at, last_event_at
) values
  ('adj_partial', 'txn_returned', 'ctm_returned', 'refund', 'partial', '{partial}', 'approved', '2026-10-03', null,
    '2026-10-03'),
  ('adj_dispute', 'txn_disputed', 'ctm_disputed', 'chargeback', 'full', '{full}', 'reversed', '2026-10-03',
    '2026-10-04', '2026-10-04'),
  ('adj_pending', 'txn_paying', 'ctm_paying', 'refund', 'full', '{full}', 'pending_approval', null, null, '2026-10-03');
insert into public.active_subscriptions (customer_id, access_status, conditional_through) values
  ('ctm_paying', 'lapsed', '2027-10-01'), ('ctm_done', 'lapsed', null);
insert into public.vested_entitlements (
  customer_id, kind, started_at, vested_through, status, confirmed_at, transaction_id, withdrawn_reason
) values
  ('ctm_paying', 'annual_term', '2026-10-01', '2027-10-01', 'conditional', null, 'txn_paying', null),
  ('ctm_done', 'annual_term', '2025-10-01', '2026-10-01', 'confirmed', '2026-10-01', 'txn_done', null),
  ('ctm_refunded', 'annual_term', '2026-09-01', '2027-09-01', 'withdrawn', null, 'txn_refunded', 'refund'),
  ('ctm_returned', 'annual_term', '2026-10-01', '2027-10-01', 'conditional', null, 'txn_returned', null),
  ('ctm_disputed', 'annual_term', '2026-10-01', '2027-10-01', 'conditional', null, 'txn_disputed', null),
  ('ctm_unrecorded', 'annual_term', '2026-10-01', '2027-10-01', 'conditional', null, 'txn_unrecorded', null);

select is((select count(*)::int from public.vested_entitlements), 6, 'six annual grants recorded');

select * from finish();
