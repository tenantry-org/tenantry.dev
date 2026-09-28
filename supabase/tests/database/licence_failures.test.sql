-- record_licence_failure records a failed licence issuance and reports whether it starts a run of failures
-- (the one the operator is alerted about). Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(10);

insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'buyer@example.com', now(), 'authenticated', 'authenticated');
insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');

select ok(public.record_licence_failure('ctm_1', 'signing failed'), 'the first failure starts a run');
select ok(not public.record_licence_failure('ctm_1', 'still failing'), 'a repeated failure does not');
select results_eq(
  $$select attempts, last_error from public.licence_failures where customer_id = 'ctm_1'$$,
  $$values (2, 'still failing'::text)$$,
  'counts the attempts and keeps the last error');

delete from public.licence_failures where customer_id = 'ctm_1';
select ok(public.record_licence_failure('ctm_1', 'failing again'), 'a failure after the record is cleared starts a new run');

select throws_ok(
  $$select public.record_licence_failure('ctm_unknown', 'signing failed')$$,
  '23503', null,
  'rejects a customer that is not recorded');

select ok(
  has_function_privilege('service_role', 'public.record_licence_failure(text, text)', 'execute'),
  'the service role can record failures');
select ok(
  not has_function_privilege('authenticated', 'public.record_licence_failure(text, text)', 'execute'),
  'a signed-in user cannot');
select ok(
  not has_function_privilege('anon', 'public.record_licence_failure(text, text)', 'execute'),
  'an anonymous user cannot');

-- The errors are internal: not even the customer they concern can read them.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "email": "buyer@example.com", "role": "authenticated"}';

select is((select count(*)::int from public.customers), 1, 'the signed-in customer reads their own customer row');
select is((select count(*)::int from public.licence_failures), 0, 'but not their licence failures');

select * from finish();
rollback;
