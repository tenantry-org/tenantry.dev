-- set_customer_access records a customer's access (derived by the app from all their entitlements) and
-- returns the status it replaced, which decides whether access starts or ends. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');

select is(public.set_customer_access('ctm_1', 'active', 'pro'), 'revoked', 'a customer seen for the first time had no access');
select results_eq(
  $$select status, tier, github_granted from public.customer_access where customer_id = 'ctm_1'$$,
  $$values ('active'::text, 'pro'::text, false)$$,
  'records the access');

update public.customer_access set github_granted = true where customer_id = 'ctm_1';

select is(public.set_customer_access('ctm_1', 'grace', 'starter'), 'active', 'returns the status it replaced');
select results_eq(
  $$select status, tier, github_granted from public.customer_access where customer_id = 'ctm_1'$$,
  $$values ('grace'::text, 'starter'::text, true)$$,
  'staying entitled keeps the GitHub grant');

select is(public.set_customer_access('ctm_1', 'revoked', null), 'grace', 'ending access returns the entitled status');
select results_eq(
  $$select status, tier, github_granted from public.customer_access where customer_id = 'ctm_1'$$,
  $$values ('revoked'::text, null::text, false)$$,
  'ending access clears the GitHub grant');

select is(public.set_customer_access('ctm_1', 'revoked', null), 'revoked', 'a repeated end is not a change');

select throws_ok(
  $$select public.set_customer_access('ctm_1', 'expired', null)$$,
  '23514', null,
  'rejects an unknown status');
select throws_ok(
  $$select public.set_customer_access('ctm_unknown', 'active', 'pro')$$,
  '23503', null,
  'rejects a customer that is not recorded');

select ok(
  has_function_privilege('service_role', 'public.set_customer_access(text, text, text)', 'execute'),
  'the service role can record access');
select ok(
  not has_function_privilege('authenticated', 'public.set_customer_access(text, text, text)', 'execute'),
  'a signed-in user cannot');
select ok(
  not has_function_privilege('anon', 'public.set_customer_access(text, text, text)', 'execute'),
  'an anonymous user cannot');

select hasnt_column('public', 'entitlements', 'github_granted', 'the GitHub grant is no longer per subscription');
select has_column('public', 'entitlements', 'current_period_ends_at', 'entitlements record the billing period end');

select * from finish();
rollback;
