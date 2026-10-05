-- What 20261005140000_test_customers.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after every
-- later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(2);

select results_eq(
  $$select customer_id, is_test from public.customers order by customer_id$$,
  $$values ('ctm_buyer'::text, false), ('ctm_maintainer'::text, false)$$,
  'every existing customer is a real one until an operator marks it');
select throws_ok(
  $$update public.customers set is_test = null where customer_id = 'ctm_buyer'$$,
  '23502', null, 'a customer is a test customer or not, never unknown');

select * from finish();
rollback;
