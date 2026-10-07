-- What 20261007090000_adjustment_consequences.sql made of before.sql's rows. Run by scripts/test-migrations.sh.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(2);

select has_column('public', 'payment_adjustments', 'consequences_applied_at',
  'adjustments record when they were acted on');
select is(
  (select consequences_applied_at from public.payment_adjustments where adjustment_id = 'adj_refund'),
  '2026-09-10 00:00:05+00'::timestamptz,
  'an existing adjustment counts as acted on when it was last recorded, so it is not acted on again');

select * from finish();
rollback;
