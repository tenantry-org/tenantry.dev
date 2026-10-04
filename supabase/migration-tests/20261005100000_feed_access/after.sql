-- What 20261005100000_feed_access.sql made of before.sql's rows. Run by scripts/test-migrations.sh, after every later
-- migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(4);

select results_eq(
  $$select customer_id, access_status, grace_ends_at from public.active_subscriptions
    where customer_id <> 'ctm_grace_unknown' order by customer_id$$,
  $$values
    ('ctm_active'::text, 'active'::text, null::timestamptz),
    ('ctm_grace', 'grace', '2026-10-31 00:00+00'),
    ('ctm_grace_two', 'grace', '2026-10-25 00:00+00'),
    ('ctm_lapsed', 'lapsed', null)$$,
  'a customer in grace takes the latest grace end of their past-due subscriptions; no one else has one');
select ok(
  (select grace_ends_at <= now() from public.active_subscriptions where customer_id = 'ctm_grace_unknown'),
  'a customer recorded in grace with no date to take one from has a grace end that has passed, never none');
select results_eq(
  $$select customer_id, access_status, grace_ends_at from public.feed_customer(encode(sha256('tpf_grace'), 'hex'))$$,
  $$values ('ctm_grace'::text, 'grace'::text, '2026-10-31 00:00+00'::timestamptz)$$,
  'the feed reads the grace end with the access');
select throws_ok(
  $$update public.active_subscriptions set grace_ends_at = null where customer_id = 'ctm_grace'$$,
  '23514', null, 'a customer in grace always has a grace end');

select * from finish();
rollback;
