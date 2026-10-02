-- set_customer_access records a customer's access (derived by the app from all their entitlements) and
-- returns the status it replaced, which decides whether access starts or ends. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(16);

insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');

select is(public.set_customer_access('ctm_1', 'active'), 'revoked', 'a customer seen for the first time had no access');
select results_eq(
  $$select status, github_state, github_invited_at from public.customer_access where customer_id = 'ctm_1'$$,
  $$values ('active'::text, 'none'::text, null::timestamptz)$$,
  'records the access');

update public.customer_access set github_state = 'invited', github_invited_at = now() where customer_id = 'ctm_1';

select is(public.set_customer_access('ctm_1', 'grace'), 'active', 'returns the status it replaced');
select results_eq(
  $$select status, github_state, github_invited_at is not null from public.customer_access where customer_id = 'ctm_1'$$,
  $$values ('grace'::text, 'invited'::text, true)$$,
  'staying entitled keeps the GitHub state');

select is(public.set_customer_access('ctm_1', 'revoked'), 'grace', 'ending access returns the entitled status');
select results_eq(
  $$select status, github_state, github_invited_at from public.customer_access where customer_id = 'ctm_1'$$,
  $$values ('revoked'::text, 'none'::text, null::timestamptz)$$,
  'ending access resets the GitHub state');

select is(public.set_customer_access('ctm_1', 'revoked'), 'revoked', 'a repeated end is not a change');

select throws_ok(
  $$select public.set_customer_access('ctm_1', 'expired')$$,
  '23514', null,
  'rejects an unknown status');
select throws_ok(
  $$select public.set_customer_access('ctm_unknown', 'active')$$,
  '23503', null,
  'rejects a customer that is not recorded');

select ok(
  has_function_privilege('service_role', 'public.set_customer_access(text, text)', 'execute'),
  'the service role can record access');
select ok(
  not has_function_privilege('authenticated', 'public.set_customer_access(text, text)', 'execute'),
  'a signed-in user cannot');
select ok(
  not has_function_privilege('anon', 'public.set_customer_access(text, text)', 'execute'),
  'an anonymous user cannot');

-- The GitHub state, and when an invitation was sent.
select throws_ok(
  $$update public.customer_access set github_state = 'granted' where customer_id = 'ctm_1'$$,
  '23514', null,
  'rejects an unknown GitHub state');
select throws_ok(
  $$update public.customer_access set github_state = 'invited', github_invited_at = null where customer_id = 'ctm_1'$$,
  '23514', null,
  'an invitation records when it was sent');
select throws_ok(
  $$update public.customer_access set github_state = 'active', github_invited_at = now() where customer_id = 'ctm_1'$$,
  '23514', null,
  'only an invitation has a sent time');
select lives_ok(
  $$update public.customer_access set github_state = 'failed', github_invited_at = null where customer_id = 'ctm_1'$$,
  'a failed grant is recorded');

select * from finish();
rollback;
