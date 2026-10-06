-- What 20261006090000_reconcile_backlog.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after every
-- later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(3);

select results_eq(
  $$select id, status from public.customer_jobs order by id$$,
  $$values ('ntf_backlog'::text, 'pending'::text), ('reconcile_ctm_backlog_0', 'done'),
    ('reconcile_ctm_backlog_1', 'pending'), ('reconcile_ctm_failed_1', 'failed'),
    ('reconcile_ctm_failed_2', 'pending'), ('reconcile_ctm_tie_a', 'pending')$$,
  'each customer keeps their oldest pending reconcile job, and every other kind or status of job');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at)
    values ('reconcile_ctm_backlog_3', 'reconcile', 'ctm_backlog', now())$$,
  '23505', null, 'a second pending reconcile job is refused');
select results_eq(
  $$select id from public.claim_customer_jobs(10, 60) order by id$$,
  $$values ('reconcile_ctm_backlog_1'::text), ('reconcile_ctm_failed_2'), ('reconcile_ctm_tie_a')$$,
  'the Paddle event still waits for its customer''s older reconcile job');

select * from finish();
rollback;
