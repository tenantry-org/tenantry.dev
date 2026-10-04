-- Owner policies: a signed-in user sees a Paddle customer's rows only when the customer's email is their
-- confirmed email, compared case-insensitively. Run with `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(18);

-- The buyer signed up with the address they bought with but has not confirmed it yet (as an impostor
-- using a purchaser's address would be); another user is confirmed; a third bought with a mixed-case
-- address, which Supabase Auth stores lowercased.
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'buyer@example.com', null, 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com', now(), 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'mixed@example.com', now(), 'authenticated', 'authenticated');

-- Paddle keeps the address as the buyer typed it.
insert into public.customers (customer_id, email) values
  ('ctm_buyer', 'buyer@example.com'),
  ('ctm_mixed', '  Mixed@Example.COM ');
insert into public.subscriptions (subscription_id, status, customer_id) values
  ('sub_buyer', 'active', 'ctm_buyer');
insert into public.active_subscriptions (customer_id, access_status) values
  ('ctm_buyer', 'active');
insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, confirmed_at) values
  ('ctm_buyer', 'qualifying_run', '2027-01-01', '2028-01-01', 'confirmed', now());
insert into public.licences (customer_id, jwt) values
  ('ctm_buyer', 'buyer-licence'),
  ('ctm_mixed', 'mixed-licence');
insert into public.github_links (customer_id, github_login, github_id) values
  ('ctm_buyer', 'octocat', 42);

select is(
  (select email from public.customers where customer_id = 'ctm_mixed'),
  'mixed@example.com',
  'customer emails are stored lowercased and trimmed');

select throws_ok(
  $$insert into public.customers (customer_id, email) values ('ctm_duplicate', 'BUYER@example.com')$$,
  '23505', null,
  'a second customer with the same address in another case is rejected');

-- As the buyer, before confirming the address.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "email": "buyer@example.com", "role": "authenticated"}';

select is((select count(*)::int from public.customers), 0, 'unconfirmed: no customer row');
select is((select count(*)::int from public.licences), 0, 'unconfirmed: no licence');
select is((select count(*)::int from public.vested_entitlements), 0, 'unconfirmed: no vested entitlement');
select is((select count(*)::int from public.active_subscriptions), 0, 'unconfirmed: no access');
select is((select count(*)::int from public.subscriptions), 0, 'unconfirmed: no subscription');
select is((select count(*)::int from public.github_links), 0, 'unconfirmed: no GitHub link');

-- The buyer confirms the address.
set local role postgres;
update auth.users set email_confirmed_at = now() where id = '11111111-1111-1111-1111-111111111111';
set local role authenticated;

select is((select count(*)::int from public.customers), 1, 'confirmed: their customer row');
select is((select jwt from public.licences), 'buyer-licence', 'confirmed: their licence, and only theirs');
select is((select count(*)::int from public.vested_entitlements), 1, 'confirmed: their vested entitlement');
select is((select access_status from public.active_subscriptions), 'active', 'confirmed: their access');
select is((select count(*)::int from public.subscriptions), 1, 'confirmed: their subscription');
select is((select count(*)::int from public.github_links), 1, 'confirmed: their GitHub link');

-- The policies read the user's own confirmed address, not the JWT's email claim.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "email": "buyer@example.com", "role": "authenticated"}';

select is((select count(*)::int from public.customers), 0, 'another user: no customer row, whatever the email claim');
select is((select count(*)::int from public.licences), 0, 'another user: no licence');

-- The customer who bought with a mixed-case address.
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "email": "mixed@example.com", "role": "authenticated"}';

select is((select jwt from public.licences), 'mixed-licence', 'mixed-case purchase: their licence');
select is((select count(*)::int from public.customers), 1, 'mixed-case purchase: their customer row');

select * from finish();
rollback;
