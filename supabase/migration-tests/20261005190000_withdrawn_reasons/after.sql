-- What 20261005190000_withdrawn_reasons.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after every
-- later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(2);

select results_eq(
  $$select customer_id, withdrawn_reason from public.vested_entitlements order by customer_id$$,
  $$values ('ctm_refund'::text, 'refund'::text)$$,
  'a grant withdrawn as not completed is left to the recompute; one withdrawn by a refund stays');
select throws_ok(
  $$insert into public.vested_entitlements (
      customer_id, kind, started_at, vested_through, status, transaction_id, withdrawn_reason
    ) values ('ctm_old', 'annual_term', '2027-01-01', '2028-01-01', 'withdrawn', 'txn_new', 'term_not_completed')$$,
  '23514', null, 'term_not_completed is no longer a reason');

select * from finish();
rollback;
