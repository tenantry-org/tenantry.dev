-- Subscription events: one that occurred before the last one applied, delivered after it, changes nothing.
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(10);

insert into public.customers (customer_id, email) values ('ctm_sub', 'sub@example.com');

select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', null, null, '2026-09-28 11:00:00+00'),
  true, 'the first event for a subscription is applied');
select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'canceled', 'pri_1', 'pro_1', null, null, '2026-09-28 12:00:00+00'),
  true, 'a newer event is applied');
select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', null, null, '2026-09-28 11:30:00+00'),
  false, 'an update that occurred before the cancellation, delivered after it, is not applied');
select results_eq(
  $$select status, last_event_at from public.subscriptions where subscription_id = 'sub_1'$$,
  $$values ('canceled'::text, '2026-09-28 12:00:00+00'::timestamptz)$$,
  'so the subscription stays cancelled');
select is(
  public.record_subscription_event('sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', null, null, '2026-09-28 12:00:00+00'),
  true, 'an event at the same instant as the last one is applied');

-- Paddle's timestamps, such as a scheduled change's effective_at, have microseconds and a Z.
select is(
  public.record_subscription_event(
    'sub_1', 'ctm_sub', 'active', 'pri_1', 'pro_1', '2026-10-28T12:00:00.123456Z', 'cancel', '2026-09-28 13:00:00+00'),
  true, 'an event with a scheduled cancellation is applied');
select results_eq(
  $$select scheduled_change_at, scheduled_change_action from public.subscriptions where subscription_id = 'sub_1'$$,
  $$values ('2026-10-28 12:00:00.123456+00'::timestamptz, 'cancel'::text)$$,
  'the scheduled change records when it takes effect and what it is');

select throws_ok(
  $$select public.record_subscription_event('sub_2', 'ctm_unknown', 'active', 'pri_1', 'pro_1', null, null, now())$$,
  '23503', null,
  'a subscription event for a customer that does not exist yet fails, so it is retried');

select ok(
  has_function_privilege(
    'service_role',
    'public.record_subscription_event(text, text, text, text, text, timestamptz, text, timestamptz)',
    'execute'),
  'the service role can record subscription events');
set local role authenticated;
select throws_ok(
  $$select public.record_subscription_event('sub_1', 'ctm_sub', 'active', null, null, null, null, now())$$,
  '42501', null,
  'signed-in users cannot');
set local role postgres;

select * from finish();
rollback;
