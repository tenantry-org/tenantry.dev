-- Rows as 20261006100000 left the schema, loaded before 20261007090000_adjustment_consequences.sql runs: an adjustment
-- acted on when it was recorded. scripts/test-migrations.sh runs this, the migration, then after.sql.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values ('ctm_sandbox', 'sandbox@example.com');
insert into public.payment_adjustments (
  adjustment_id, transaction_id, customer_id, action, type, item_types, status, approved_at, last_event_at,
  updated_at
) values (
  'adj_refund', 'txn_sandbox', 'ctm_sandbox', 'refund', 'full', '{full}', 'approved', '2026-09-10', '2026-09-10',
  '2026-09-10 00:00:05+00'
);

select pass('the earlier schema''s rows are loaded');
select * from finish();
