-- Rows as the schema after 20261005130000_reconcile_paid_time.sql held them, loaded before
-- 20261005140000_test_customers.sql runs. scripts/test-migrations.sh runs this, the migrations after it, then after.sql.
-- Not a transaction: the rows must still be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customers (customer_id, email) values
  ('ctm_buyer', 'buyer@example.com'),
  ('ctm_maintainer', 'releases@example.com');

select is((select count(*)::int from public.customers), 2, 'two customers recorded');

select * from finish();
