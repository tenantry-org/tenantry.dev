-- Customer jobs: deduplicated Paddle notifications, what each kind of job holds, and claiming one customer's jobs at a
-- time, oldest first. Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(19);

-- Deduplication: the notification id is the job's id, so a second delivery of a notification is a no-op.
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload)
values ('ntf_dup', 'paddle_event', 'ctm_dup', '2026-09-28 10:00:00+00', 'customer.created', '{}')
on conflict (id) do nothing;
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload)
values ('ntf_dup', 'paddle_event', 'ctm_dup', '2026-09-28 10:00:00+00', 'customer.created', '{"second": true}')
on conflict (id) do nothing;

select is((select count(*)::int from public.customer_jobs where id = 'ntf_dup'), 1, 'a duplicate delivery adds no job');
select is((select payload from public.customer_jobs where id = 'ntf_dup'), '{}'::jsonb, 'the first delivery is kept');
update public.customer_jobs set status = 'done' where id = 'ntf_dup';

-- What each kind holds.
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at) values ('job_x', 'refund', 'ctm_x', now())$$,
  '23514', null, 'rejects an unknown kind');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at, payload)
    values ('ntf_x', 'paddle_event', 'ctm_x', now(), '{}')$$,
  '23514', null, 'a Paddle event has its type');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type)
    values ('ntf_x', 'paddle_event', 'ctm_x', now(), 'subscription.updated')$$,
  '23514', null, 'a Paddle event has its body');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload)
    values ('reconcile_x', 'reconcile', 'ctm_x', now(), 'subscription.updated', '{}')$$,
  '23514', null, 'a reconcile job has no Paddle event');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, customer_id, occurred_at) values ('lease_x', 'lease', 'ctm_x', now())$$,
  '23514', null, 'there is no lease kind of job any more');
select throws_ok(
  $$insert into public.customer_jobs (id, kind, occurred_at) values ('reconcile_x', 'reconcile', now())$$,
  '23514', null, 'a reconcile job has a customer');
select lives_ok(
  $$insert into public.customer_jobs (id, kind, occurred_at, event_type, payload, status)
    values ('ntf_product', 'paddle_event', now(), 'product.updated', '{}', 'done')$$,
  'a Paddle event may concern no customer');

-- Customer A has a Paddle event and a reconcile job, customer B a Paddle event.
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload) values
  ('ntf_a1', 'paddle_event', 'ctm_a', '2026-09-28 10:01:00+00', 'subscription.created', '{}'),
  ('ntf_b1', 'paddle_event', 'ctm_b', '2026-09-28 10:01:30+00', 'subscription.created', '{}');
insert into public.customer_jobs (id, kind, customer_id, occurred_at) values
  ('reconcile_a', 'reconcile', 'ctm_a', '2026-09-28 10:02:00+00');

select results_eq(
  $$select id, kind from public.claim_customer_jobs(10, 60) order by id$$,
  $$values ('ntf_a1', 'paddle_event'), ('ntf_b1', 'paddle_event')$$,
  'a claim takes the oldest job of each customer');
select is((select attempts from public.customer_jobs where id = 'ntf_a1'), 1, 'claiming counts an attempt');
select is_empty(
  $$select id from public.claim_customer_jobs(10, 60)$$,
  'nothing more is claimed while each customer has a job in progress');

update public.customer_jobs set status = 'done', locked_until = null where id = 'ntf_a1';
select results_eq(
  $$select id, kind from public.claim_customer_jobs(10, 60)$$,
  $$values ('reconcile_a', 'reconcile')$$,
  'the customer''s next job is claimed once the previous one is done, whatever its kind');

-- Paddle does not guarantee delivery order: an older event that arrives while a newer job runs waits for it.
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload) values
  ('ntf_a0', 'paddle_event', 'ctm_a', '2026-09-28 10:00:30+00', 'subscription.created', '{}');
select is_empty(
  $$select id from public.claim_customer_jobs(10, 60) where customer_id = 'ctm_a'$$,
  'an older event delivered late waits while the customer''s newer job runs');

-- An expired lock (a worker that died) can be claimed again.
update public.customer_jobs set locked_until = now() - interval '1 second' where id = 'ntf_b1';
select results_eq(
  $$select id, attempts from public.claim_customer_jobs(10, 60)$$,
  $$values ('ntf_b1', 2)$$,
  'a job whose lock expired is claimed again');

-- A job waiting to be retried holds back that customer's later jobs.
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload, next_attempt_at) values
  ('ntf_c1', 'paddle_event', 'ctm_c', '2026-09-28 10:05:00+00', 'subscription.created', '{}', now() + interval '10 minutes'),
  ('ntf_c2', 'paddle_event', 'ctm_c', '2026-09-28 10:06:00+00', 'subscription.updated', '{}', now());
select is_empty(
  $$select id from public.claim_customer_jobs(10, 60) where customer_id = 'ctm_c'$$,
  'a customer''s later jobs wait for an earlier one that is not due yet');

-- Only the service role may claim jobs, and no signed-in user may read them.
select ok(
  has_function_privilege('service_role', 'public.claim_customer_jobs(integer, integer)', 'execute'),
  'the service role can claim jobs');
set local role authenticated;
select throws_ok($$select * from public.claim_customer_jobs(1, 60)$$, '42501', null, 'signed-in users cannot claim jobs');
select is_empty($$select 1 from public.customer_jobs$$, 'signed-in users see no jobs');
set local role postgres;

select * from finish();
rollback;
