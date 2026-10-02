-- Customer leases: account linking takes the same per-customer turn as the customer's jobs.
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(11);

-- The lease is taken while the customer has nothing in progress.
select isnt(public.acquire_customer_lease('ctm_lease', 60), null, 'a lease is granted when nothing is in progress');
select is(public.acquire_customer_lease('ctm_lease', 60), null, 'a second lease waits for the first');
select isnt(public.acquire_customer_lease('ctm_other', 60), null, 'another customer is not affected');
select results_eq(
  $$select kind, customer_id, event_type, payload from public.customer_jobs where customer_id = 'ctm_lease'$$,
  $$values ('lease'::text, 'ctm_lease'::text, null::text, null::jsonb)$$,
  'a lease is a job of its own kind');

-- While it is held, none of the customer's jobs are handed out, not even one queued before it; other customers' are.
insert into public.customer_jobs (id, kind, customer_id, occurred_at) values
  ('reconcile_lease', 'reconcile', 'ctm_lease', now() - interval '1 minute');
insert into public.customer_jobs (id, kind, customer_id, occurred_at, event_type, payload) values
  ('evt_other', 'paddle_event', 'ctm_free', now(), 'subscription.updated', '{}');
select results_eq(
  $$select id from public.claim_customer_jobs(10, 60) where customer_id in ('ctm_lease', 'ctm_free')$$,
  $$values ('evt_other'::text)$$,
  'a reconcile job for the customer waits while the lease is held');
select public.release_customer_lease('reconcile_lease');
select is(
  (select status from public.customer_jobs where id = 'reconcile_lease'), 'pending',
  'releasing a lease never completes another job');

-- Released: the customer's jobs are claimed again.
select public.release_customer_lease(id) from public.customer_jobs where customer_id = 'ctm_lease' and kind = 'lease';
select is(
  (select status from public.customer_jobs where customer_id = 'ctm_lease' and kind = 'lease'),
  'done', 'releasing completes the lease');
select results_eq(
  $$select id from public.claim_customer_jobs(10, 60) where customer_id = 'ctm_lease'$$,
  $$values ('reconcile_lease'::text)$$,
  'the reconcile job runs once the lease is released');

-- The reconcile job is being run (claimed, so locked): no lease until it is done.
select is(public.acquire_customer_lease('ctm_lease', 60), null, 'no lease while one of the customer''s jobs runs');
update public.customer_jobs set status = 'done', locked_until = null where id = 'reconcile_lease';
select isnt(public.acquire_customer_lease('ctm_lease', 60), null, 'a lease once it is done');

-- A lease whose holder died expires, and is then claimed like any job (and completed as a no-op).
update public.customer_jobs set locked_until = now() - interval '1 second'
where customer_id = 'ctm_lease' and kind = 'lease' and status = 'pending';
select results_eq(
  $$select kind from public.claim_customer_jobs(10, 60) where customer_id = 'ctm_lease'$$,
  $$values ('lease'::text)$$,
  'an expired lease is claimed, so it does not block the customer for good');

select * from finish();
rollback;
