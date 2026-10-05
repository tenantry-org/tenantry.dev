-- Rows as the schema after 20261005180000_patches_take_their_minor_date.sql held them, loaded before
-- 20261005190000_withdrawn_reasons.sql runs: an annual term withdrawn as not completed, and one withdrawn by a refund.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_old', 'old@example.com'), ('ctm_refund', 'refund@example.com');
insert into public.vested_entitlements (
  customer_id, kind, started_at, vested_through, status, transaction_id, withdrawn_reason
) values
  ('ctm_old', 'annual_term', '2026-01-01', '2027-01-01', 'withdrawn', 'txn_old', 'term_not_completed'),
  ('ctm_refund', 'annual_term', '2026-01-01', '2027-01-01', 'withdrawn', 'txn_refund', 'refund');

select is((select count(*)::int from public.vested_entitlements), 2, 'two withdrawn grants recorded');

select * from finish();
