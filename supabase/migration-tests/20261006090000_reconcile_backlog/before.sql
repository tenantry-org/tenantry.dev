-- Rows as the schema after 20261005200000_paid_time_adds_up.sql held them, loaded before
-- 20261006090000_reconcile_backlog.sql runs: reconcile jobs left pending by runs that did not reach them, a Paddle
-- event waiting behind one, and jobs that are done or failed.
-- scripts/test-migrations.sh runs this, the migrations after it, then after.sql. Not a transaction: the rows must still
-- be there when the migration runs.
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(1);

insert into public.customer_jobs (id, kind, customer_id, occurred_at, status) values
  ('reconcile_ctm_backlog_0', 'reconcile', 'ctm_backlog', '2026-10-03 04:00+00', 'done'),
  ('reconcile_ctm_backlog_1', 'reconcile', 'ctm_backlog', '2026-10-04 04:00+00', 'pending'),
  ('reconcile_ctm_backlog_2', 'reconcile', 'ctm_backlog', '2026-10-05 04:00+00', 'pending'),
  ('reconcile_ctm_tie_a', 'reconcile', 'ctm_tie', '2026-10-05 04:00+00', 'pending'),
  ('reconcile_ctm_tie_b', 'reconcile', 'ctm_tie', '2026-10-05 04:00+00', 'pending'),
  ('reconcile_ctm_failed_1', 'reconcile', 'ctm_failed', '2026-10-04 04:00+00', 'failed'),
  ('reconcile_ctm_failed_2', 'reconcile', 'ctm_failed', '2026-10-05 04:00+00', 'pending');
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload) values
  ('ntf_backlog', 'paddle_event', 'ctm_backlog', '2026-10-05 05:00+00', 'transaction.completed', '{}');

select is((select count(*)::int from public.customer_jobs where status = 'pending'), 6, 'six jobs pending');

select * from finish();
