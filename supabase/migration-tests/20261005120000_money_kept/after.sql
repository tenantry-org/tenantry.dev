-- What 20261005120000_money_kept.sql made of before.sql's rows. Run by scripts/test-migrations.sh.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(7);

select has_column('public', 'payments', 'tax', 'payments record their tax');
select has_column('public', 'payment_adjustments', 'subtotal', 'adjustments record what they returned before tax');
select results_eq(
  $$select tax from public.payments where transaction_id = 'txn_sandbox'$$, $$values (null::bigint)$$,
  'an existing payment''s tax is not guessed');
select results_eq(
  $$select adjustment_id, subtotal from public.payment_adjustments order by adjustment_id$$,
  $$values ('adj_partial'::text, null::bigint), ('adj_tax', null)$$,
  'nor an existing adjustment''s amount');
select hasnt_function('public', 'record_payment',
  array['text', 'text', 'text', 'text', 'text', 'text', 'integer', 'timestamp with time zone',
    'timestamp with time zone', 'bigint', 'bigint', 'bigint', 'text', 'timestamp with time zone'],
  'record_payment without the tax is gone');
select has_function('public', 'record_payment',
  array['text', 'text', 'text', 'text', 'text', 'text', 'integer', 'timestamp with time zone',
    'timestamp with time zone', 'bigint', 'bigint', 'bigint', 'text', 'bigint', 'timestamp with time zone'],
  'record_payment takes the tax');
select has_function('public', 'record_payment_adjustment',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text[]', 'text', 'bigint', 'text',
    'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone'],
  'record_payment_adjustment takes the amount');

select * from finish();
rollback;
