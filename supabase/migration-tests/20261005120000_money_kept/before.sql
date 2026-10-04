-- Rows as 20261004130000 left the schema, loaded before 20261005120000_money_kept.sql runs: a payment without its tax
-- and adjustments without their amounts. scripts/test-migrations.sh runs this, the migration, then after.sql.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values ('ctm_sandbox', 'sandbox@example.com');
insert into public.payments (
  transaction_id, customer_id, subscription_id, origin, price_id, billing_interval, billing_frequency,
  period_starts_at, period_ends_at, subtotal, discount, total, currency_code, completed_at, last_event_at
) values (
  'txn_sandbox', 'ctm_sandbox', 'sub_sandbox', 'web', 'pri_1', 'month', 1, '2026-09-01', '2026-10-01', 3900, 0, 4680,
  'GBP', '2026-09-01', '2026-09-01'
);
insert into public.payment_adjustments (
  adjustment_id, transaction_id, customer_id, action, type, item_types, status, approved_at, last_event_at
) values
  ('adj_partial', 'txn_sandbox', 'ctm_sandbox', 'refund', 'partial', '{partial}', 'approved', '2026-09-10', '2026-09-10'),
  ('adj_tax', 'txn_sandbox', 'ctm_sandbox', 'refund', 'partial', '{tax}', 'approved', '2026-09-11', '2026-09-11');

select pass('the earlier schema''s rows are loaded');
select * from finish();
