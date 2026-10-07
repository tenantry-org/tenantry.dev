-- The payment ledger: record_payment and record_payment_adjustment record Paddle's transactions and adjustments once
-- each, with their amounts, whatever order their events arrive in and however often they are delivered. Run with
-- `supabase test db` against the local database.
begin;
create extension if not exists pgtap with schema extensions;
-- As postgres with pgTAP's schema on the path: `supabase test db --linked` connects to a hosted database as a
-- CLI login role that cannot use the extensions schema.
set local role postgres;
set local search_path to public, extensions;

select plan(32);

insert into public.customers (customer_id, email) values ('ctm_1', 'buyer@example.com');

-- Payments.
select is(
  public.record_payment('txn_1', 'ctm_1', 'sub_1', 'web', 'pri_1', 'month', 1, '2027-01-01', '2027-02-01', 3900, 0, 3900,
    'GBP', 650, '2027-01-01 00:05:00+00'),
  true, 'a completed transaction is recorded');
select is(
  public.record_payment('txn_1', 'ctm_1', 'sub_1', 'web', 'pri_1', 'month', 1, '2027-01-01', '2027-02-01', 3900, 0, 3900,
    'GBP', 650, '2027-01-01 00:05:00+00'),
  true, 'a repeated delivery stores the same values again');
select is(
  public.record_payment('txn_1', 'ctm_1', 'sub_1', 'web', 'pri_1', 'month', 1, '2026-01-01', '2026-02-01', 1, 0, 1,
    'GBP', 650, '2027-01-01 00:04:00+00'),
  false, 'an older event for the same transaction is not applied');
select results_eq(
  $$select count(*)::int, min(period_starts_at), min(total), min(status) from public.payments$$,
  $$values (1, '2027-01-01 00:00+00'::timestamptz, 3900::bigint, 'paid'::text)$$,
  'one payment, as its newest event described it, paid until a recompute says otherwise');

update public.payments set status = 'refunded' where transaction_id = 'txn_1';
select is(
  public.record_payment('txn_1', 'ctm_1', 'sub_1', 'web', 'pri_1', 'month', 1, '2027-01-01', '2027-02-01', 3900, 0, 3900,
    'GBP', 650, '2027-01-01 00:06:00+00'),
  true, 'a newer event is applied');
select is((select status from public.payments), 'refunded', 'and leaves the status the recompute derived');

select throws_ok(
  $$select public.record_payment('txn_2', 'ctm_unknown', 'sub_1', 'web', 'pri_1', 'month', 1, '2027-01-01',
    '2027-02-01', 3900, 0, 3900, 'GBP', 650, now())$$,
  '23503', null, 'a payment for a customer that does not exist yet fails, so it is retried');
select throws_ok(
  $$select public.record_payment('txn_3', 'ctm_1', 'sub_1', 'web', 'pri_1', 'month', 1, '2027-02-01', '2027-01-01',
    3900, 0, 3900, 'GBP', 650, now())$$,
  '23514', null, 'a period must end after it starts');
select throws_ok(
  $$update public.payments set status = 'disputed'$$,
  '23514', null, 'rejects an unknown payment status');

-- Adjustments: a refund created pending, then approved, delivered in reverse order.
select is(
  public.record_payment_adjustment('adj_1', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'full', '{full}', 'approved',
    3250, 'GBP', '2027-01-05 00:00+00', '2027-01-08 00:00+00', '2027-01-08 00:00:01+00'),
  true, 'an approved refund is recorded');
select is(
  public.record_payment_adjustment('adj_1', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'full', '{full}', 'pending_approval',
    3250, 'GBP', '2027-01-05 00:00+00', '2027-01-05 00:00+00', '2027-01-05 00:00:01+00'),
  false, 'its creation, delivered late, changes nothing');
select results_eq(
  $$select status, approved_at, reversed_at from public.payment_adjustments where adjustment_id = 'adj_1'$$,
  $$values ('approved'::text, '2027-01-08 00:00+00'::timestamptz, null::timestamptz)$$,
  'the refund stays approved, with when it was approved');

-- A chargeback, created approved, then reversed.
select is(
  public.record_payment_adjustment('adj_2', 'txn_9', 'ctm_1', null, 'chargeback', 'full', '{full}', 'reversed',
    3250, 'GBP', '2027-02-01 00:00+00', '2027-03-01 00:00+00', '2027-03-01 00:00:01+00'),
  true, 'a chargeback first seen reversed is recorded, before its transaction is');
select results_eq(
  $$select status, approved_at, reversed_at from public.payment_adjustments where adjustment_id = 'adj_2'$$,
  $$values ('reversed'::text, '2027-02-01 00:00+00'::timestamptz, '2027-03-01 00:00+00'::timestamptz)$$,
  'it was approved when it was created, and reversed later');
select is(
  public.record_payment_adjustment('adj_2', 'txn_9', 'ctm_1', null, 'chargeback', 'full', '{full}', 'approved',
    3250, 'GBP', '2027-02-01 00:00+00', '2027-02-01 00:00+00', '2027-02-01 00:00:01+00'),
  false, 'its approval, delivered late, does not undo the reversal');
select is((select status from public.payment_adjustments where adjustment_id = 'adj_2'), 'reversed',
  'so it stays reversed');
select is(
  public.record_payment_adjustment('adj_2', 'txn_9', 'ctm_1', null, 'chargeback', 'full', '{full}', 'reversed',
    3250, 'GBP', '2027-02-01 00:00+00', '2027-03-01 00:00+00', '2027-03-01 00:00:01+00'),
  true, 'a repeated delivery is applied again with the same values');
select is((select count(*)::int from public.payment_adjustments), 2, 'two adjustments, so far');

-- Amounts: what was charged and what each adjustment returned, before tax, as the entitlement rules compare them.
select results_eq(
  $$select subtotal, discount, total, tax from public.payments where transaction_id = 'txn_1'$$,
  $$values (3900::bigint, 0::bigint, 3900::bigint, 650::bigint)$$,
  'a payment records its tax with its totals');
select results_eq(
  $$select subtotal, currency_code from public.payment_adjustments where adjustment_id = 'adj_1'$$,
  $$values (3250::bigint, 'GBP'::text)$$,
  'an adjustment records what it returned before tax');
select is(
  public.record_payment_adjustment('adj_3', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'partial', '{partial}', 'approved',
    null, null, '2027-01-09 00:00+00', '2027-01-09 00:00+00', '2027-01-09 00:00:01+00'),
  true, 'an adjustment whose amount is not known is recorded without one');
select is(
  public.record_payment_adjustment('adj_3', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'partial', '{partial}', 'approved',
    1000, 'GBP', '2027-01-09 00:00+00', '2027-01-09 00:00+00', '2027-01-09 00:00:01+00'),
  true, 'and a replay of its event fills the amount in');
select is((select subtotal from public.payment_adjustments where adjustment_id = 'adj_3'), 1000::bigint,
  'the amount is kept');
select is(
  public.record_payment_adjustment('adj_3', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'partial', '{partial}', 'approved',
    null, null, '2027-01-09 00:00+00', '2027-01-09 00:00+00', '2027-01-09 00:00:01+00'),
  true, 'an event without the amount');
select is((select subtotal from public.payment_adjustments where adjustment_id = 'adj_3'), 1000::bigint,
  'does not forget it');

-- Acting on an adjustment: marked once acted on, and cleared only when a newer event changes its status.
select is(
  public.record_payment_adjustment('adj_4', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'full', '{full}', 'pending_approval',
    3900, 'GBP', '2027-01-10 00:00+00', '2027-01-10 00:00+00', '2027-01-10 00:00:01+00'),
  true, 'a new adjustment is recorded');
select is((select consequences_applied_at from public.payment_adjustments where adjustment_id = 'adj_4'), null,
  'and is still to be acted on');
update public.payment_adjustments set consequences_applied_at = '2027-01-10 00:01+00' where adjustment_id = 'adj_4';
select public.record_payment_adjustment('adj_4', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'full', '{full}',
  'pending_approval', 3900, 'GBP', '2027-01-10 00:00+00', '2027-01-10 00:00+00', '2027-01-10 00:00:02+00');
select is((select consequences_applied_at from public.payment_adjustments where adjustment_id = 'adj_4'),
  '2027-01-10 00:01+00'::timestamptz, 'an event in the same status leaves it acted on');
select public.record_payment_adjustment('adj_4', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'full', '{full}', 'approved',
  3900, 'GBP', '2027-01-10 00:00+00', '2027-01-11 00:00+00', '2027-01-11 00:00:01+00');
select is((select consequences_applied_at from public.payment_adjustments where adjustment_id = 'adj_4'), null,
  'its approval is to be acted on');
update public.payment_adjustments set consequences_applied_at = '2027-01-11 00:01+00' where adjustment_id = 'adj_4';
select public.record_payment_adjustment('adj_4', 'txn_1', 'ctm_1', 'sub_1', 'refund', 'full', '{full}',
  'pending_approval', 3900, 'GBP', '2027-01-10 00:00+00', '2027-01-10 00:00+00', '2027-01-10 00:00:01+00');
select results_eq(
  $$select status, consequences_applied_at from public.payment_adjustments where adjustment_id = 'adj_4'$$,
  $$values ('approved'::text, '2027-01-11 00:01+00'::timestamptz)$$,
  'an older event delivered late leaves it approved and acted on');

select ok(
  has_function_privilege('service_role',
    'public.record_payment(text, text, text, text, text, text, integer, timestamptz, timestamptz, bigint, bigint, bigint,
      text, bigint, timestamptz)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.record_payment(text, text, text, text, text, text, integer, timestamptz, timestamptz, bigint, bigint, bigint,
      text, bigint, timestamptz)',
    'execute'),
  'only the service role records payments');
select ok(
  has_function_privilege('service_role',
    'public.record_payment_adjustment(text, text, text, text, text, text, text[], text, bigint, text, timestamptz,
      timestamptz, timestamptz)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.record_payment_adjustment(text, text, text, text, text, text, text[], text, bigint, text, timestamptz,
      timestamptz, timestamptz)',
    'execute'),
  'only the service role records adjustments');

select * from finish();
rollback;
