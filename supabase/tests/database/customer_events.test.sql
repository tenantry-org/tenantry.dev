-- Customer events: a delayed customer.updated cannot restore an older email, and with it ownership.
-- Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  public.record_customer_event('ctm_1', 'Old@Example.com', '2026-09-29 10:00:00+00'),
  true, 'customer.created is applied');
select is(
  public.record_customer_event('ctm_1', 'new@example.com', '2026-09-29 11:00:00+00'),
  true, 'a newer email change is applied');
select is(
  public.record_customer_event('ctm_1', 'old@example.com', '2026-09-29 10:30:00+00'),
  false, 'an update that occurred before the change, delivered after it, is not applied');
select results_eq(
  $$select email, last_event_at from public.customers where customer_id = 'ctm_1'$$,
  $$values ('new@example.com'::text, '2026-09-29 11:00:00+00'::timestamptz)$$,
  'so the newer email, and the ownership it gives, is kept');
select is(
  public.record_customer_event('ctm_1', 'NEWER@example.com ', '2026-09-29 11:00:00+00'),
  true, 'an event at the same instant as the last one is applied');
select is((select email from public.customers where customer_id = 'ctm_1'), 'newer@example.com', 'normalised as always');

select * from finish();
rollback;
