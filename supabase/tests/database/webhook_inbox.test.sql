-- The webhook inbox: deduplication, per-customer ordered claiming, and stale subscription events.
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(17);

-- Deduplication: the primary key makes a second delivery of an event a no-op.
insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload)
values ('evt_dup', 'customer.created', '2026-09-28 10:00:00+00', 'ctm_dup', '{}')
on conflict (event_id) do nothing;
insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload)
values ('evt_dup', 'customer.created', '2026-09-28 10:00:00+00', 'ctm_dup', '{"second": true}')
on conflict (event_id) do nothing;

select is((select count(*)::int from public.webhook_inbox where event_id = 'evt_dup'), 1, 'a duplicate delivery adds no row');
select is((select payload from public.webhook_inbox where event_id = 'evt_dup'), '{}'::jsonb, 'the first delivery is kept');
update public.webhook_inbox set status = 'done' where event_id = 'evt_dup';

-- Customer A has two events, customer B one.
insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload) values
  ('evt_a2', 'subscription.updated', '2026-09-28 10:02:00+00', 'ctm_a', '{}'),
  ('evt_a1', 'subscription.created', '2026-09-28 10:01:00+00', 'ctm_a', '{}'),
  ('evt_b1', 'subscription.created', '2026-09-28 10:01:30+00', 'ctm_b', '{}');

select results_eq(
  $$select event_id from public.claim_webhook_events(10, 60) order by event_id$$,
  $$values ('evt_a1'), ('evt_b1')$$,
  'a claim takes the oldest event of each customer');
select is((select attempts from public.webhook_inbox where event_id = 'evt_a1'), 1, 'claiming counts an attempt');
select is_empty(
  $$select event_id from public.claim_webhook_events(10, 60)$$,
  'nothing more is claimed while each customer has an event in progress');

update public.webhook_inbox set status = 'done', locked_until = null where event_id = 'evt_a1';
select results_eq(
  $$select event_id from public.claim_webhook_events(10, 60)$$,
  $$values ('evt_a2')$$,
  'the customer''s next event is claimed once the previous one is done');

-- An expired lock (a worker that died) can be claimed again.
update public.webhook_inbox set locked_until = now() - interval '1 second' where event_id = 'evt_b1';
select results_eq(
  $$select event_id, attempts from public.claim_webhook_events(10, 60)$$,
  $$values ('evt_b1', 2)$$,
  'an event whose lock expired is claimed again');

-- An event waiting to be retried holds back that customer's later events.
insert into public.webhook_inbox (event_id, event_type, occurred_at, customer_id, payload, next_attempt_at) values
  ('evt_c1', 'subscription.created', '2026-09-28 10:05:00+00', 'ctm_c', '{}', now() + interval '10 minutes'),
  ('evt_c2', 'subscription.updated', '2026-09-28 10:06:00+00', 'ctm_c', '{}', now());
select is_empty(
  $$select event_id from public.claim_webhook_events(10, 60) where customer_id = 'ctm_c'$$,
  'a customer''s later events wait for an earlier one that is not due yet');

-- Stale subscription events.
insert into public.customers (customer_id, email) values ('ctm_sub', 'sub@example.com');

select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', null, '2026-09-28 11:00:00+00'),
  true, 'the first event for a subscription is applied');
select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'canceled', 'pri_1', 'pro_1', null, '2026-09-28 12:00:00+00'),
  true, 'a newer event is applied');
select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', null, '2026-09-28 11:30:00+00'),
  false, 'an update that occurred before the cancellation, delivered after it, is not applied');
select results_eq(
  $$select subscription_status, last_event_at from public.subscriptions where subscription_id = 'sub_1'$$,
  $$values ('canceled'::text, '2026-09-28 12:00:00+00'::timestamptz)$$,
  'so the subscription stays cancelled');
select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', null, '2026-09-28 12:00:00+00'),
  true, 'an event at the same instant as the last one is applied');

select throws_ok(
  $$select public.record_subscription_event('sub_2', 'ctm_unknown', 'active', 'pri_1', 'pro_1', null, now())$$,
  '23503', null,
  'a subscription event for a customer that does not exist yet fails, so it is retried');

-- Only the service role may use the functions.
set local role authenticated;
select throws_ok($$select * from public.claim_webhook_events(1, 60)$$, '42501', null, 'signed-in users cannot claim events');
select throws_ok(
  $$select public.record_subscription_event('sub_1', 'ctm_sub', 'active', null, null, null, now())$$,
  '42501', null,
  'signed-in users cannot record subscription events');
set local role postgres;

select hasnt_table('public', 'processed_webhook_events', 'the old deduplication table is gone');

select * from finish();
rollback;
