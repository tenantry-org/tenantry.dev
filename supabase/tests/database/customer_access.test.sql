-- set_customer_access records a customer's access (derived by the app from all their entitlements) and
-- returns the status it replaced, which decides whether access starts or ends. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

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

select hasnt_column('public', 'entitlements', 'github_granted', 'the GitHub grant is no longer per subscription');
select has_column('public', 'entitlements', 'current_period_ends_at', 'entitlements record the billing period end');

-- One Pro offer (D10): nothing records a tier.
select hasnt_column('public', 'entitlements', 'tier', 'entitlements have no tier');
select hasnt_column('public', 'customer_access', 'tier', 'customer access has no tier');
select hasnt_column('public', 'licences', 'tier', 'licences have no tier');
select hasnt_function('public', 'set_customer_access', array['text', 'text', 'text'], 'set_customer_access takes no tier');

-- GitHub invitation state (6.7).
select hasnt_column('public', 'customer_access', 'github_granted', 'github_granted is replaced by github_state');
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
