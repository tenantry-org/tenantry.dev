-- Customer leases: account linking takes the same per-customer turn as Paddle events and reconcile jobs.
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(9);

-- The lease is taken while the customer has nothing in progress.
select isnt(public.acquire_customer_lease('ctm_lease', 60), null, 'a lease is granted when nothing is in progress');
select is(public.acquire_customer_lease('ctm_lease', 60), null, 'a second lease waits for the first');
select isnt(public.acquire_customer_lease('ctm_other', 60), null, 'another customer is not affected');

-- While it is held, none of the customer's events are handed out; other customers' are.
insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload) values
  ('evt_lease_reconcile', 'tenantry.reconcile_customer', now(), 'ctm_lease', '{}'),
  ('evt_other', 'subscription.updated', now(), 'ctm_free', '{}');
select results_eq(
  $$select event_id from public.claim_webhook_events(10, 60) where customer_id in ('ctm_lease', 'ctm_free')$$,
  $$values ('evt_other'::text)$$,
  'a reconcile job for the customer waits while the lease is held');

-- Released: the customer's events are claimed again.
select public.release_customer_lease(event_id) from public.webhook_inbox
where customer_id = 'ctm_lease' and event_type = 'tenantry.customer_lease';
select is(
  (select status from public.webhook_inbox where customer_id = 'ctm_lease' and event_type = 'tenantry.customer_lease'),
  'done', 'releasing completes the lease');
select results_eq(
  $$select event_id from public.claim_webhook_events(10, 60) where customer_id = 'ctm_lease'$$,
  $$values ('evt_lease_reconcile'::text)$$,
  'the reconcile job runs once the lease is released');

-- The reconcile job is being processed (claimed, so locked): no lease until it is done.
select is(public.acquire_customer_lease('ctm_lease', 60), null, 'no lease while one of the customer''s events runs');
update public.webhook_inbox set status = 'done', locked_until = null where event_id = 'evt_lease_reconcile';
select isnt(public.acquire_customer_lease('ctm_lease', 60), null, 'a lease once it is done');

-- A lease whose holder died expires, and is then claimed like any event (and completed as a no-op).
update public.webhook_inbox set locked_until = now() - interval '1 second'
where customer_id = 'ctm_lease' and event_type = 'tenantry.customer_lease' and status = 'pending';
select results_eq(
  $$select event_type from public.claim_webhook_events(10, 60) where customer_id = 'ctm_lease'$$,
  $$values ('tenantry.customer_lease'::text)$$,
  'an expired lease is claimed, so it does not block the customer for good');

select * from finish();
rollback;
