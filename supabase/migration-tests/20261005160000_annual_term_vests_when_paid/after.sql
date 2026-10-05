-- What 20261005160000_annual_term_vests_when_paid.sql made of before.sql's rows. Run by scripts/test-migrations.sh,
-- after every later migration too.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path to public, extensions;

select plan(7);

select results_eq(
  $$select customer_id, status, confirmed_at, withdrawn_reason from public.vested_entitlements order by customer_id$$,
  $$values
    ('ctm_done'::text, 'confirmed'::text, '2026-10-01 00:00+00'::timestamptz, null::text),
    ('ctm_paying', 'confirmed', '2026-10-01 00:00+00', null),
    ('ctm_refunded', 'withdrawn', null, 'refund')$$,
  'an annual term kept so far is confirmed from when it was paid (a refund pending approval returns nothing); a '
    || 'conditional term with money returned, or a reversal, or no recorded payment, is left to the recompute');
select is_empty(
  $$select 1 from public.vested_entitlements where customer_id in ('ctm_returned', 'ctm_disputed', 'ctm_unrecorded')$$,
  'so those customers are vested in nothing until it runs');
select is(public.vested_through('ctm_paying'), '2027-10-01 00:00+00'::timestamptz,
  'so its customer is vested through the end of the term at once');
select hasnt_column('public', 'active_subscriptions', 'conditional_through', 'no grant waits to be confirmed');
select throws_ok(
  $$insert into public.vested_entitlements (customer_id, kind, started_at, vested_through, status, transaction_id)
    values ('ctm_done', 'annual_term', '2027-10-01', '2028-10-01', 'conditional', 'txn_next')$$,
  '23514', null, 'a conditional grant is refused');
select lives_ok(
  $$select public.set_customer_entitlement('ctm_paying', '{"access_status": "lapsed"}',
    '[{"kind": "annual_term", "started_at": "2026-10-01T00:00:00Z", "vested_through": "2027-10-01T00:00:00Z",
       "status": "confirmed", "confirmed_at": "2026-10-01T00:00:00Z", "transaction_id": "txn_paying",
       "withdrawn_reason": null}]', '{}')$$,
  'set_customer_entitlement stores a state without conditional_through');
select ok(
  not public.customers_to_reconcile() && array['ctm_done', 'ctm_refunded']
    and public.customers_to_reconcile() @> array['ctm_returned', 'ctm_disputed'],
  'a confirmed annual grant alone does not call for a reconcile; a term still being paid for does, so the rows left '
    || 'to the recompute are stored again');

select * from finish();
rollback;
