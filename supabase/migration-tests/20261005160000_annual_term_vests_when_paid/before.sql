-- Rows as the schema after 20261005150000_offered_prices.sql held them, loaded before
-- 20261005160000_annual_term_vests_when_paid.sql runs: an annual term kept so far (conditional), one completed
-- (confirmed) and one refunded (withdrawn), and a customer whose state names a term waiting to be confirmed.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_paying', 'paying@example.com'), ('ctm_done', 'done@example.com'), ('ctm_refunded', 'refunded@example.com');
insert into public.active_subscriptions (customer_id, access_status, conditional_through) values
  ('ctm_paying', 'lapsed', '2027-10-01'), ('ctm_done', 'lapsed', null);
insert into public.vested_entitlements (
  customer_id, kind, started_at, vested_through, status, confirmed_at, transaction_id, withdrawn_reason
) values
  ('ctm_paying', 'annual_term', '2026-10-01', '2027-10-01', 'conditional', null, 'txn_paying', null),
  ('ctm_done', 'annual_term', '2025-10-01', '2026-10-01', 'confirmed', '2026-10-01', 'txn_done', null),
  ('ctm_refunded', 'annual_term', '2026-09-01', '2027-09-01', 'withdrawn', null, 'txn_refunded', 'refund');

select is((select count(*)::int from public.vested_entitlements), 3, 'three annual grants recorded');

select * from finish();
