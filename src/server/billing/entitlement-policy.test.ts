import { describe, expect, it } from 'vitest';
import type { Entitlement, Payment, PaymentAdjustment, SubscriptionState } from '@/server/db/billing-store';
import {
  addMonths,
  canRestore,
  computeEntitlement,
  currentAccess,
  coversRelease,
  type EntitlementInput,
  type EntitlementRules,
  mayUseRelease,
  wholeMonths,
} from './entitlement-policy';

// The rules of the plan's section 2 (plans-and-investigations/Tenantry-Licensing-And-Feed-Plan.md), each row of its
// rules table, its worked example, and the edge cases around them.

const date = (iso: string) => new Date(iso);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

let transactions = 0;

/** One paid period of `months` months from `start`. */
function payment(start: string, options: Partial<Payment> & { months?: number } = {}): Payment {
  const { months = 1, ...rest } = options;
  transactions += 1;
  return {
    transactionId: `txn_${transactions}`,
    subscriptionId: 'sub_1',
    billingInterval: months >= 12 ? 'year' : 'month',
    billingFrequency: months >= 12 ? months / 12 : months,
    periodStartsAt: date(start),
    periodEndsAt: addMonths(date(start), months),
    total: months >= 12 ? 39000 : 3900,
    ...rest,
  };
}

/** `count` consecutive monthly payments from `start`. */
function monthly(start: string, count: number, options: Partial<Payment> = {}): Payment[] {
  return Array.from({ length: count }, (_, i) => payment(addMonths(date(start), i).toISOString(), options));
}

function annual(start: string, options: Partial<Payment> = {}): Payment {
  return payment(start, { months: 12, ...options });
}

let adjustments = 0;

function adjustment(
  of: Payment,
  action: string,
  approvedAt: string,
  options: Partial<PaymentAdjustment> = {},
): PaymentAdjustment {
  adjustments += 1;
  return {
    adjustmentId: `adj_${adjustments}`,
    transactionId: of.transactionId,
    action,
    type: 'full',
    itemTypes: [options.type === 'partial' ? 'partial' : 'full'],
    status: 'approved',
    approvedAt: date(approvedAt),
    reversedAt: null,
    ...options,
  };
}

const PRO = 'pro_01';

/** A Pro subscription that is running (active, unless another Paddle status is given). */
function running(subscriptionId = 'sub_1', status = 'active', graceStartedAt: string | null = null): SubscriptionState {
  return {
    subscriptionId,
    productId: PRO,
    status,
    graceStartedAt: graceStartedAt ? date(graceStartedAt) : null,
    endedAt: null,
  };
}

/** A Pro subscription that was cancelled (or paused) at `at`. */
function ended(subscriptionId: string, at: string, status = 'canceled'): SubscriptionState {
  return { subscriptionId, productId: PRO, status, graceStartedAt: null, endedAt: date(at) };
}

/** By default sub_1 is running, or, given `endedAt`, ended then. */
function compute(
  input: Omit<Partial<EntitlementInput>, 'now'> & { now: string; endedAt?: string },
  rules?: EntitlementRules,
): Entitlement {
  const { now, endedAt, ...rest } = input;

  return computeEntitlement(
    {
      payments: [],
      adjustments: [],
      subscriptions: [endedAt ? ended('sub_1', endedAt) : running()],
      proProductId: PRO,
      ...rest,
      now: date(now),
    },
    rules,
  );
}

const vested = (entitlement: Entitlement) => iso(entitlement.vestedThrough);

describe('the rules table', () => {
  it('earns perpetual rights after the first 12 consecutive monthly payments, once the 12th month is served', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12);

    // The 12th payment is taken on 1 December; the 12th month is not served until 1 January.
    expect(vested(compute({ payments, now: '2027-12-01T00:00:00Z' }))).toBeNull();
    expect(vested(compute({ payments, now: '2027-12-31T23:59:59Z' }))).toBeNull();

    const atTwelve = compute({ payments, now: '2028-01-01T00:00:00Z' });
    expect(vested(atTwelve)).toBe('2028-01-01T00:00:00.000Z');
    expect(atTwelve.grants).toEqual([
      {
        kind: 'qualifying_run',
        startedAt: date('2027-01-01T00:00:00Z'),
        vestedThrough: date('2028-01-01T00:00:00Z'),
        status: 'confirmed',
        confirmedAt: date('2028-01-01T00:00:00Z'),
        transactionId: null,
        withdrawnReason: null,
      },
    ]);
  });

  it('keeps advancing the perpetual entitlement while the monthly subscription continues', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 15);

    const entitlement = compute({ payments, now: '2028-03-10T00:00:00Z' });

    // Periods ending 1 February and 1 March 2028 are served; the one ending 1 April is not yet.
    expect(vested(entitlement)).toBe('2028-03-01T00:00:00.000Z');
    expect(entitlement.grants).toHaveLength(1);
    expect(entitlement.run).toMatchObject({ monthsPaid: 15, vestsAt: date('2028-01-01T00:00:00Z') });
  });

  it('resets the qualifying run to zero when the subscription lapses', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 7);

    const subscribed = compute({ payments, now: '2027-07-15T00:00:00Z' });
    expect(subscribed.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), monthsPaid: 7 });

    const lapsed = compute({ payments, now: '2027-08-15T00:00:00Z', endedAt: '2027-08-01T00:00:00Z' });
    expect(lapsed.run).toBeNull();
    expect(lapsed.vestedThrough).toBeNull();
  });

  it('requires another 12 consecutive paid months of a customer who resubscribes monthly', () => {
    const payments = [...monthly('2027-01-01T00:00:00Z', 7), ...monthly('2027-10-01T00:00:00Z', 12)];

    const eleven = compute({ payments, now: '2028-09-01T00:00:00Z' });
    expect(eleven.run).toMatchObject({ startedAt: date('2027-10-01T00:00:00Z'), monthsPaid: 12 });
    expect(eleven.vestedThrough).toBeNull();

    expect(vested(compute({ payments, now: '2028-10-01T00:00:00Z' }))).toBe('2028-10-01T00:00:00.000Z');
  });

  it('grants an annual plan at once, conditionally on completing the term', () => {
    const entitlement = compute({ payments: [annual('2027-03-01T00:00:00Z')], now: '2027-03-01T00:00:01Z' });

    expect(entitlement.vestedThrough).toBeNull();
    expect(iso(entitlement.conditionalThrough)).toBe('2028-03-01T00:00:00.000Z');
    expect(entitlement.grants).toEqual([
      expect.objectContaining({ kind: 'annual_term', status: 'conditional', transactionId: expect.any(String) }),
    ]);
  });

  it('confirms the annual grant when the term ends without a qualifying refund', () => {
    const entitlement = compute({ payments: [annual('2027-03-01T00:00:00Z')], now: '2028-03-01T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-03-01T00:00:00.000Z');
    expect(entitlement.conditionalThrough).toBeNull();
    expect(entitlement.grants.map((grant) => [grant.kind, grant.status])).toEqual([
      ['qualifying_run', 'confirmed'],
      ['annual_term', 'confirmed'],
    ]);
  });

  it('withdraws the annual grant when the plan is partially refunded for an unserved term', () => {
    const term = annual('2027-03-01T00:00:00Z');
    const refund = adjustment(term, 'refund', '2027-09-01T00:00:00Z', { type: 'partial', itemTypes: ['proration'] });

    const entitlement = compute({
      payments: [term],
      adjustments: [refund],
      now: '2028-06-01T00:00:00Z',
      endedAt: '2027-09-01T00:00:00Z',
    });

    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.conditionalThrough).toBeNull();
    expect(entitlement.grants).toEqual([
      expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
    ]);
    expect(entitlement.paymentStatuses[term.transactionId]).toBe('partially_refunded');
  });

  it('never takes away a vested entitlement when the subscription is cancelled later', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 14);

    const entitlement = compute({ payments, now: '2031-01-01T00:00:00Z', endedAt: '2028-03-01T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-03-01T00:00:00.000Z');
    expect(entitlement.run).toBeNull();
  });

  it('does not count a charged-back payment towards the 12 months', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12);
    const chargeback = adjustment(payments[4], 'chargeback', '2027-06-15T00:00:00Z');

    const entitlement = compute({ payments, adjustments: [chargeback], now: '2028-01-01T00:00:00Z' });

    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.paymentStatuses[payments[4].transactionId]).toBe('charged_back');
    expect(entitlement.run).toMatchObject({ startedAt: date('2027-06-01T00:00:00Z'), monthsPaid: 7 });
  });
});

describe('the owner’s example', () => {
  // Monthly through 2027, cancelled at the end of December. v1.4 came out in 2027, v1.5 during the gap in 2028, v1.6
  // just before the customer came back in June 2028.
  const v14 = date('2027-11-20T12:00:00Z');
  const v15 = date('2028-03-15T12:00:00Z');
  const v16 = date('2028-05-20T12:00:00Z');
  const firstRun = monthly('2027-01-01T00:00:00Z', 12, { subscriptionId: 'sub_1' });
  const firstEnd = ended('sub_1', '2028-01-01T00:00:00Z');

  it('vests through the end of December 2027 after Jan to Dec 2027, covering v1.4', () => {
    const entitlement = compute({ payments: firstRun, now: '2028-01-01T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(coversRelease(entitlement.vestedThrough, v14)).toBe(true);
  });

  it('keeps that date and resets the run when cancelled at period end in January 2028', () => {
    const entitlement = compute({
      payments: firstRun,
      subscriptions: [firstEnd],
      now: '2028-01-20T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(entitlement.run).toBeNull();
  });

  const comeback = (count: number) => monthly('2028-06-01T00:00:00Z', count, { subscriptionId: 'sub_2' });

  it('starts a new run of 1 when they resubscribe monthly in June 2028', () => {
    const entitlement = compute({
      payments: [...firstRun, ...comeback(1)],
      subscriptions: [firstEnd, running('sub_2')],
      now: '2028-06-10T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(entitlement.run).toMatchObject({ startedAt: date('2028-06-01T00:00:00Z'), monthsPaid: 1 });
    expect(coversRelease(entitlement.vestedThrough, v16)).toBe(false);
  });

  it('keeps v1.4 and no right to v1.6 when they cancel in August 2028', () => {
    const entitlement = compute({
      payments: [...firstRun, ...comeback(2)],
      subscriptions: [firstEnd, ended('sub_2', '2028-08-01T00:00:00Z')],
      now: '2028-09-01T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(entitlement.run).toBeNull();
    expect(coversRelease(entitlement.vestedThrough, v14)).toBe(true);
    expect(coversRelease(entitlement.vestedThrough, v16)).toBe(false);
  });

  it('vests through May 2029, including v1.5 from the gap, if they stay to the end of May 2029', () => {
    const entitlement = compute({
      payments: [...firstRun, ...comeback(12)],
      subscriptions: [firstEnd, running('sub_2')],
      now: '2029-06-01T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2029-06-01T00:00:00.000Z');
    expect(entitlement.grants.filter((grant) => grant.status === 'confirmed')).toHaveLength(2);
    expect(coversRelease(entitlement.vestedThrough, v15)).toBe(true);
    expect(coversRelease(entitlement.vestedThrough, v16)).toBe(true);
  });

  it('grants to June 2029 conditionally if they buy annual in June 2028, and confirms it at the term end', () => {
    const payments = [...firstRun, annual('2028-06-01T00:00:00Z', { subscriptionId: 'sub_2' })];

    const during = compute({ payments, subscriptions: [firstEnd, running('sub_2')], now: '2028-12-01T00:00:00Z' });
    expect(vested(during)).toBe('2028-01-01T00:00:00.000Z');
    expect(iso(during.conditionalThrough)).toBe('2029-06-01T00:00:00.000Z');

    const after = compute({ payments, subscriptions: [firstEnd, running('sub_2')], now: '2029-06-01T00:00:00Z' });
    expect(vested(after)).toBe('2029-06-01T00:00:00.000Z');
    expect(after.conditionalThrough).toBeNull();
  });
});

describe('edge cases', () => {
  it('keeps the run when a renewal is recovered inside Paddle’s retry window', () => {
    // The March renewal fails on 1 March and is paid on 20 March; Paddle bills it for the period from 1 March
    // (paddle-assumptions.ts), so nothing is missing.
    const payments = monthly('2027-01-01T00:00:00Z', 12);

    expect(vested(compute({ payments, now: '2028-01-01T00:00:00Z' }))).toBe('2028-01-01T00:00:00.000Z');
  });

  it('allows timestamp jitter between periods, but a gap of one day breaks the run', () => {
    const jitter = monthly('2027-01-01T00:00:00Z', 6).concat(monthly('2027-07-01T00:30:00Z', 6));
    expect(compute({ payments: jitter, now: '2028-01-02T00:00:00Z' }).vestedThrough).not.toBeNull();

    const gap = monthly('2027-01-01T00:00:00Z', 6).concat(monthly('2027-07-02T00:00:00Z', 6));
    const entitlement = compute({ payments: gap, now: '2028-01-03T00:00:00Z' });
    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.run).toMatchObject({ startedAt: date('2027-07-02T00:00:00Z'), monthsPaid: 6 });
  });

  it('breaks the run at a month refunded in the middle of it, before the run vests', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 14);
    const refund = adjustment(payments[2], 'refund', '2027-03-10T00:00:00Z');

    const entitlement = compute({ payments, adjustments: [refund], now: '2028-03-01T00:00:00Z' });

    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.run).toMatchObject({ startedAt: date('2027-04-01T00:00:00Z'), monthsPaid: 11 });
    expect(entitlement.paymentStatuses[payments[2].transactionId]).toBe('refunded');
  });

  it('does not undo vesting confirmed before a refund of one of its months', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 13);
    const refund = adjustment(payments[2], 'refund', '2028-01-15T00:00:00Z');

    const entitlement = compute({ payments, adjustments: [refund], now: '2028-02-01T00:00:00Z' });

    // Confirmed on 1 January with every month paid; the run then no longer continues from the refunded month, so the
    // February period end does not advance it.
    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('keeps a month that was only partially refunded', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12);
    const partial = adjustment(payments[5], 'refund', '2027-06-10T00:00:00Z', { type: 'partial' });

    const entitlement = compute({ payments, adjustments: [partial], now: '2028-01-01T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(entitlement.paymentStatuses[payments[5].transactionId]).toBe('partially_refunded');
  });

  it('ignores refunds that are pending or rejected, and tax-only corrections', () => {
    const term = annual('2027-01-01T00:00:00Z');
    const adjustmentsMade = [
      adjustment(term, 'refund', '2027-02-01T00:00:00Z', { status: 'pending_approval', approvedAt: null }),
      adjustment(term, 'refund', '2027-02-01T00:00:00Z', { status: 'rejected', approvedAt: null }),
      adjustment(term, 'refund', '2027-02-01T00:00:00Z', { type: 'partial', itemTypes: ['tax'] }),
    ];

    const entitlement = compute({ payments: [term], adjustments: adjustmentsMade, now: '2028-01-01T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(entitlement.paymentStatuses[term.transactionId]).toBe('paid');
  });

  it('does not count a 100% discounted period', () => {
    const free = payment('2027-01-01T00:00:00Z', { total: 0 });
    const payments = [free, ...monthly('2027-02-01T00:00:00Z', 12)];

    expect(compute({ payments, now: '2028-01-15T00:00:00Z' }).vestedThrough).toBeNull();
    expect(vested(compute({ payments, now: '2028-02-01T00:00:00Z' }))).toBe('2028-02-01T00:00:00.000Z');
  });

  it('counts the month in progress once when a monthly plan changes to annual with proration', () => {
    // Monthly from January; changed to annual on 15 March, which bills a prorated annual term from the change.
    const payments = [...monthly('2027-01-01T00:00:00Z', 3), annual('2027-03-15T00:00:00Z')];

    const atTwelve = compute({ payments, now: '2028-01-01T00:00:00Z' });
    expect(vested(atTwelve)).toBe('2028-01-01T00:00:00.000Z');
    expect(iso(atTwelve.conditionalThrough)).toBe('2028-03-15T00:00:00.000Z');
    expect(atTwelve.run).toMatchObject({ monthsPaid: 14 });

    expect(vested(compute({ payments, now: '2028-03-15T00:00:00Z' }))).toBe('2028-03-15T00:00:00.000Z');
  });

  it('continues the run when an annual term is followed by monthly payments at its end', () => {
    const payments = [annual('2027-01-01T00:00:00Z'), ...monthly('2028-01-01T00:00:00Z', 2)];

    expect(vested(compute({ payments, now: '2028-03-01T00:00:00Z' }))).toBe('2028-03-01T00:00:00.000Z');
  });

  it('counts overlapping periods of two subscriptions once', () => {
    const payments = [
      ...monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' }),
      ...monthly('2027-01-10T00:00:00Z', 6, { subscriptionId: 'sub_2' }),
    ];

    const entitlement = compute({ payments, now: '2027-07-05T00:00:00Z' });

    expect(entitlement.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), monthsPaid: 6 });
  });

  it('withdraws an annual grant when the subscription ends before the term does, even without a refund', () => {
    const entitlement = compute({
      payments: [annual('2027-01-01T00:00:00Z')],
      now: '2028-02-01T00:00:00Z',
      endedAt: '2027-05-01T00:00:00Z',
    });

    expect(entitlement.grants).toEqual([
      expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'term_not_completed' }),
    ]);
    expect(entitlement.vestedThrough).toBeNull();
  });

  it('confirms an annual grant whose subscription was cancelled at the end of the term', () => {
    const entitlement = compute({
      payments: [annual('2027-01-01T00:00:00Z')],
      now: '2028-02-01T00:00:00Z',
      endedAt: '2028-01-01T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('does not withdraw a confirmed annual grant for a refund approved after the term', () => {
    const term = annual('2027-01-01T00:00:00Z');
    const late = adjustment(term, 'refund', '2028-02-01T00:00:00Z', { type: 'partial' });

    expect(vested(compute({ payments: [term], adjustments: [late], now: '2028-03-01T00:00:00Z' }))).toBe(
      '2028-01-01T00:00:00.000Z',
    );
  });

  it('withdraws an annual grant credited for an unserved term (an immediate change to monthly)', () => {
    const term = annual('2027-01-01T00:00:00Z');
    const credit = adjustment(term, 'credit', '2027-06-01T00:00:00Z', { type: 'partial', itemTypes: ['proration'] });

    const entitlement = compute({ payments: [term], adjustments: [credit], now: '2027-06-02T00:00:00Z' });

    expect(entitlement.grants).toEqual([expect.objectContaining({ status: 'withdrawn', withdrawnReason: 'refund' })]);
  });

  describe('an annual term partially refunded or credited', () => {
    // Monthly from January 2027, annual from 1 July 2027, changed back to monthly on 1 October 2027: Paddle credits
    // the unserved part of the annual term, and monthly payments resume from the change.
    const before = monthly('2027-01-01T00:00:00Z', 6);
    const term = annual('2027-07-01T00:00:00Z');
    const after = monthly('2027-10-01T00:00:00Z', 6);
    const credit = adjustment(term, 'credit', '2027-10-01T00:00:00Z', { type: 'partial', itemTypes: ['proration'] });

    it('counts the term up to the credit, so the run continues through the change', () => {
      const withCredit = compute({
        payments: [...before, term, ...after],
        adjustments: [credit],
        now: '2028-03-15T00:00:00Z',
      });

      expect(vested(withCredit)).toBe('2028-03-01T00:00:00.000Z');
      expect(withCredit.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), monthsPaid: 15 });
      expect(withCredit.grants).toContainEqual(
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
      );
    });

    it('vests as the same history would without the credit, apart from the annual grant', () => {
      const withCredit = compute({
        payments: [...before, term, ...after],
        adjustments: [credit],
        now: '2028-03-15T00:00:00Z',
      });
      const withoutCredit = compute({ payments: [...before, term, ...after], now: '2028-03-15T00:00:00Z' });

      expect(vested(withoutCredit)).toBe('2028-03-01T00:00:00.000Z');
      expect(vested(withCredit)).toBe(vested(withoutCredit));
    });

    it('counts a partially refunded term up to the refund, then breaks the run where nothing follows it', () => {
      const refund = adjustment(term, 'refund', '2027-11-01T00:00:00Z', { type: 'partial', itemTypes: ['partial'] });

      const entitlement = compute({
        payments: [...before, term],
        adjustments: [refund],
        now: '2027-12-01T00:00:00Z',
        endedAt: '2027-11-01T00:00:00Z',
      });

      expect(entitlement.vestedThrough).toBeNull();
      expect(entitlement.grants).toEqual([expect.objectContaining({ kind: 'annual_term', status: 'withdrawn' })]);
      // Ten months served (January to November) remain counted towards a run that a return within the hour continues.
      const resumed = compute({
        payments: [...before, term, ...monthly('2027-11-01T00:00:00Z', 2)],
        adjustments: [refund],
        now: '2028-01-01T00:00:00Z',
      });
      expect(vested(resumed)).toBe('2028-01-01T00:00:00.000Z');
    });

    it('withdraws the grant for a seat-reduction credit mid-term, counting the term only up to the credit', () => {
      // An annual term whose quantity is reduced on 1 April 2027: Paddle credits the unused seats, and the term runs
      // on to January 2028 with no new payment. Only the term up to the credit is a paid period.
      const seats = annual('2027-01-01T00:00:00Z');
      const seatCredit = adjustment(seats, 'credit', '2027-04-01T00:00:00Z', {
        type: 'partial',
        itemTypes: ['proration'],
      });

      const entitlement = compute({ payments: [seats], adjustments: [seatCredit], now: '2027-06-01T00:00:00Z' });

      expect(entitlement.grants).toEqual([expect.objectContaining({ status: 'withdrawn', withdrawnReason: 'refund' })]);
      expect(entitlement.run).toBeNull();
      expect(entitlement.paymentStatuses[seats.transactionId]).toBe('partially_refunded');
    });

    describe('a partial refund near the end of a first annual term', () => {
      // An annual term from 1 January 2027, the customer's first payment, partially refunded at `at`. A term cut short
      // by an adjustment must reach the full 12 months to vest: the month-end tolerance is for Paddle's renewal dates.
      const first = annual('2027-01-01T00:00:00Z');
      const refundedAt = (at: string) =>
        compute({
          payments: [first],
          adjustments: [adjustment(first, 'refund', at, { type: 'partial', itemTypes: ['partial'] })],
          now: '2028-02-01T00:00:00Z',
        });

      it.each(['2027-06-01T00:00:00Z', '2027-12-28T00:00:00Z', '2027-12-29T00:00:00Z', '2027-12-31T23:00:00Z'])(
        'gives no perpetual rights for a refund approved on %s',
        (at) => {
          const entitlement = refundedAt(at);

          expect(entitlement.vestedThrough).toBeNull();
          expect(entitlement.grants).toEqual([
            expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
          ]);
        },
      );

      it('vests the served 12 months, but not the grant, for a refund approved exactly at the term end', () => {
        const entitlement = refundedAt('2028-01-01T00:00:00Z');

        expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
        expect(entitlement.grants).toEqual([
          expect.objectContaining({ kind: 'qualifying_run', status: 'confirmed' }),
          expect.objectContaining({ kind: 'annual_term', status: 'withdrawn' }),
        ]);
      });

      it('gives no perpetual rights to a term whose subscription was cancelled in its last days', () => {
        const entitlement = compute({
          payments: [first],
          now: '2028-02-01T00:00:00Z',
          endedAt: '2027-12-30T00:00:00Z',
        });

        expect(entitlement.vestedThrough).toBeNull();
      });
    });

    it('still drops a term refunded in full or charged back', () => {
      for (const action of ['refund', 'chargeback']) {
        const full = adjustment(term, action, '2027-10-01T00:00:00Z');
        const entitlement = compute({
          payments: [...before, term, ...after],
          adjustments: [full],
          now: '2028-03-15T00:00:00Z',
        });

        expect(entitlement.vestedThrough).toBeNull();
        expect(entitlement.run).toMatchObject({ startedAt: date('2027-10-01T00:00:00Z') });
      }
    });
  });

  it('breaks the run at a pause: the period ends when paused, and the resumed one starts later', () => {
    const before = monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' });
    // Paused on 15 June, mid-period; resumed on 1 August as a new subscription period (recorded here under another id,
    // since the paused end is what the subscription row holds until it resumes).
    const after = monthly('2027-08-01T00:00:00Z', 6, { subscriptionId: 'sub_2' });

    const entitlement = compute({
      payments: [...before, ...after],
      subscriptions: [ended('sub_1', '2027-06-15T00:00:00Z', 'paused'), running('sub_2')],
      now: '2028-01-15T00:00:00Z',
    });

    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.run).toMatchObject({ startedAt: date('2027-08-01T00:00:00Z') });
  });

  it('vests a run started on the 31st whose month-end periods fall a few days short of 12 months', () => {
    // Paddle may bill 31 January, 28 February, 28 March, … (paddle-assumptions.ts).
    let start = date('2027-01-31T09:00:00Z');
    const payments = [];
    for (let i = 0; i < 12; i++) {
      const end = i === 0 ? date('2027-02-28T09:00:00Z') : addMonths(start, 1);
      payments.push(payment(start.toISOString(), { periodEndsAt: end }));
      start = end;
    }

    const entitlement = compute({ payments, now: '2028-01-28T09:00:00Z' });

    expect(vested(entitlement)).toBe('2028-01-28T09:00:00.000Z');
  });

  it('records the payment of a period paid late in its retry window by its billing period, not its payment date', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 2);

    expect(compute({ payments, now: '2027-03-20T00:00:00Z' }).run).toMatchObject({
      paidThrough: date('2027-03-01T00:00:00Z'),
    });
  });

  it('shows no current run for a customer with access whose last period ended more than a grace period ago', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 3);

    expect(compute({ payments, now: '2027-05-15T00:00:00Z' }).run).toBeNull();
  });
});

describe('chargebacks', () => {
  const payments = monthly('2027-01-01T00:00:00Z', 13);
  const lateChargeback = adjustment(payments[3], 'chargeback', '2028-01-20T00:00:00Z');

  it('withdraws vesting already confirmed while chargebacks undo it (the default)', () => {
    const entitlement = compute({ payments, adjustments: [lateChargeback], now: '2028-02-01T00:00:00Z' });

    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.grants).toEqual([
      expect.objectContaining({
        kind: 'qualifying_run',
        startedAt: date('2027-01-01T00:00:00Z'),
        status: 'withdrawn',
        withdrawnReason: 'chargeback',
      }),
    ]);
  });

  it('keeps vesting confirmed before the chargeback when chargebacks do not undo it', () => {
    const entitlement = compute(
      { payments, adjustments: [lateChargeback], now: '2028-02-01T00:00:00Z' },
      { chargebackUndoesConfirmedVesting: false },
    );

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('counts the payment again once the chargeback is reversed', () => {
    const reversedOnTheChargeback = { ...lateChargeback, status: 'reversed', reversedAt: date('2028-01-25T00:00:00Z') };
    const reversal = adjustment(payments[3], 'chargeback_reverse', '2028-01-25T00:00:00Z');

    for (const adjustmentsMade of [[reversedOnTheChargeback], [lateChargeback, reversal]]) {
      const entitlement = compute({ payments, adjustments: adjustmentsMade, now: '2028-02-01T00:00:00Z' });
      expect(vested(entitlement)).toBe('2028-02-01T00:00:00.000Z');
      expect(entitlement.paymentStatuses[payments[3].transactionId]).toBe('paid');
    }
  });

  it('withdraws a confirmed annual grant whose payment is charged back, while chargebacks undo vesting', () => {
    const term = annual('2027-01-01T00:00:00Z');
    const chargeback = adjustment(term, 'chargeback', '2028-02-01T00:00:00Z');

    const undone = compute({ payments: [term], adjustments: [chargeback], now: '2028-03-01T00:00:00Z' });
    expect(undone.vestedThrough).toBeNull();
    expect(undone.grants).toContainEqual(
      expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'chargeback' }),
    );

    const kept = compute(
      { payments: [term], adjustments: [chargeback], now: '2028-03-01T00:00:00Z' },
      { chargebackUndoesConfirmedVesting: false },
    );
    expect(vested(kept)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('ignores chargeback warnings', () => {
    const warning = adjustment(payments[3], 'chargeback_warning', '2027-05-01T00:00:00Z');

    expect(vested(compute({ payments, adjustments: [warning], now: '2028-01-01T00:00:00Z' }))).toBe(
      '2028-01-01T00:00:00.000Z',
    );
  });
});

describe('access', () => {
  const NOW = date('2026-11-01T00:00:00Z');
  const access = (subscriptions: SubscriptionState[], now = NOW) =>
    computeEntitlement({
      subscriptions,
      payments: [],
      adjustments: [],
      proProductId: PRO,
      now,
    }).access;

  it('is lapsed when no Pro subscription entitles the customer', () => {
    expect(access([])).toEqual({ status: 'lapsed', graceEndsAt: null });
    expect(access([ended('sub_1', '2026-10-01T00:00:00Z'), ended('sub_2', '2026-10-01T00:00:00Z', 'paused')])).toEqual({
      status: 'lapsed',
      graceEndsAt: null,
    });
    expect(access([{ ...running(), productId: 'pro_other' }]).status).toBe('lapsed');
  });

  it('is active if any Pro subscription is active or trialing, and grace if the only entitled ones are past due', () => {
    expect(access([running('sub_1', 'trialing')]).status).toBe('active');
    expect(access([running('sub_1', 'past_due', '2026-10-20T00:00:00Z'), running('sub_2')]).status).toBe('active');
    expect(
      access([running('sub_1', 'past_due', '2026-10-20T00:00:00Z'), ended('sub_2', '2026-10-01T00:00:00Z')]),
    ).toEqual({ status: 'grace', graceEndsAt: date('2026-11-19T00:00:00Z') });
  });

  it('keeps a past-due subscription in grace until 30 days after its first past-due event', () => {
    // The renewal on 1 October fails; grace ends 30 days later.
    const pastDue = running('sub_1', 'past_due', '2026-10-01T00:00:00Z');

    expect(access([pastDue], date('2026-10-30T23:59:59Z')).status).toBe('grace');
    expect(access([pastDue], date('2026-10-31T00:00:00Z')).status).toBe('lapsed');
    expect(access([pastDue, running('sub_2')], date('2026-10-31T00:00:00Z')).status).toBe('active');
    // With no recorded start, grace cannot be shown to be running: it has ended, so a missing date never extends it.
    expect(access([running('sub_1', 'past_due')])).toEqual({ status: 'lapsed', graceEndsAt: null });
    expect(access([running('sub_1', 'past_due'), running('sub_2', 'past_due', '2026-10-20T00:00:00Z')])).toEqual({
      status: 'grace',
      graceEndsAt: date('2026-11-19T00:00:00Z'),
    });
  });

  it('lets a customer with access use every release, and a lapsed one those their vested date covers', () => {
    const through = date('2028-01-01T00:00:00Z');
    const later = date('2029-01-01T00:00:00Z');

    expect(mayUseRelease({ accessStatus: 'active', vestedThrough: null }, later)).toBe(true);
    expect(mayUseRelease({ accessStatus: 'grace', vestedThrough: null }, later)).toBe(true);
    expect(mayUseRelease({ accessStatus: 'lapsed', vestedThrough: through }, date('2027-06-01T00:00:00Z'))).toBe(true);
    expect(mayUseRelease({ accessStatus: 'lapsed', vestedThrough: through }, later)).toBe(false);
    expect(mayUseRelease({ accessStatus: 'lapsed', vestedThrough: null }, date('2020-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('dates', () => {
  it('adds calendar months in UTC, ending on a shorter month’s last day', () => {
    expect(addMonths(date('2027-01-31T10:00:00Z'), 1).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addMonths(date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(date('2027-03-15T00:00:00Z'), 12).toISOString()).toBe('2028-03-15T00:00:00.000Z');
  });

  it('counts whole months', () => {
    expect(wholeMonths(date('2027-01-01T00:00:00Z'), date('2027-12-31T00:00:00Z'))).toBe(12);
    expect(wholeMonths(date('2027-01-01T00:00:00Z'), date('2027-12-28T00:00:00Z'))).toBe(11);
    expect(wholeMonths(date('2027-01-01T00:00:00Z'), date('2027-01-01T00:00:00Z'))).toBe(0);
  });

  it('covers a release published on or before the vested-through date', () => {
    const through = date('2028-01-01T00:00:00Z');
    expect(coversRelease(through, date('2027-12-31T23:59:59Z'))).toBe(true);
    expect(coversRelease(through, through)).toBe(true);
    expect(coversRelease(through, date('2028-01-01T00:00:01Z'))).toBe(false);
    expect(coversRelease(null, date('2020-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('properties over generated histories', () => {
  // A small seeded generator, so a failure names a history that can be replayed.
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
  }

  function history(seed: number) {
    const next = random(seed);
    const payments: Payment[] = [];
    const adjustmentsMade: PaymentAdjustment[] = [];
    let start = date('2027-01-01T00:00:00Z');

    for (let i = 0; i < 30; i++) {
      const roll = next();
      if (roll < 0.1) start = new Date(start.getTime() + (1 + Math.floor(next() * 40)) * 24 * 60 * 60 * 1000);
      const months = next() < 0.15 ? 12 : 1;
      const paid = payment(start.toISOString(), { months, total: next() < 0.05 ? 0 : 3900 });
      payments.push(paid);
      if (next() < 0.1) {
        const action = next() < 0.5 ? 'refund' : 'chargeback';
        const at = new Date(paid.periodStartsAt.getTime() + Math.floor(next() * 400) * 24 * 60 * 60 * 1000);
        adjustmentsMade.push(adjustment(paid, action, at.toISOString(), { type: next() < 0.5 ? 'full' : 'partial' }));
      }
      start = paid.periodEndsAt;
    }

    return { payments, adjustments: adjustmentsMade };
  }

  function shuffle<T>(items: T[], next: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(seeds)('does not depend on the order events were recorded in (seed %i)', (seed) => {
    const { payments, adjustments: made } = history(seed);
    const next = random(seed + 1000);
    const now = '2030-01-01T00:00:00Z';

    expect(compute({ payments: shuffle(payments, next), adjustments: shuffle(made, next), now })).toEqual(
      compute({ payments, adjustments: made, now }),
    );
  });

  it.each(seeds)(
    'never vests beyond now, and never moves backwards as time passes without chargebacks (seed %i)',
    (seed) => {
      const { payments, adjustments: made } = history(seed);
      const refundsOnly = made.filter((a) => a.action === 'refund');
      let previous = 0;

      for (let month = 0; month <= 48; month += 3) {
        const now = addMonths(date('2027-01-01T00:00:00Z'), month);
        const through = computeEntitlement({
          payments,
          adjustments: refundsOnly,
          subscriptions: [running()],
          proProductId: PRO,
          now,
        }).vestedThrough;

        const time = through?.getTime() ?? 0;
        expect(time).toBeLessThanOrEqual(now.getTime());
        expect(time).toBeGreaterThanOrEqual(previous);
        previous = time;
      }
    },
  );

  it.each(seeds)(
    'vests only after at least 12 months of counted periods, or a served annual term (seed %i)',
    (seed) => {
      const { payments, adjustments: made } = history(seed);
      const entitlement = compute({ payments, adjustments: made, now: '2031-01-01T00:00:00Z' });

      for (const grant of entitlement.grants.filter((g) => g.status === 'confirmed')) {
        expect(grant.vestedThrough.getTime()).toBeGreaterThanOrEqual(
          addMonths(grant.startedAt, 12).getTime() - 3 * 24 * 60 * 60 * 1000,
        );
      }
    },
  );
});

describe('access now, from what is stored', () => {
  const now = new Date('2028-06-01T00:00:00Z');

  it('keeps active and lapsed as stored, and treats never recorded as lapsed', () => {
    expect(currentAccess({ status: 'active', graceEndsAt: null }, now)).toEqual({
      status: 'active',
      graceEndsAt: null,
    });
    expect(currentAccess({ status: 'lapsed', graceEndsAt: null }, now)).toEqual({
      status: 'lapsed',
      graceEndsAt: null,
    });
    expect(currentAccess(null, now)).toEqual({ status: 'lapsed', graceEndsAt: null });
  });

  it('keeps grace until it ends, and lapses it from that moment, before reconcile records it', () => {
    const graceEndsAt = new Date('2028-06-10T00:00:00Z');
    expect(currentAccess({ status: 'grace', graceEndsAt }, now)).toEqual({ status: 'grace', graceEndsAt });
    expect(currentAccess({ status: 'grace', graceEndsAt }, graceEndsAt)).toEqual({
      status: 'lapsed',
      graceEndsAt: null,
    });
    expect(currentAccess({ status: 'grace', graceEndsAt: null }, now)).toEqual({ status: 'lapsed', graceEndsAt: null });
  });

  it('lets the package feed serve a customer with access or vested releases, and no one else', () => {
    const vestedThrough = new Date('2027-12-31T00:00:00Z');
    expect(canRestore({ accessStatus: 'active', vestedThrough: null })).toBe(true);
    expect(canRestore({ accessStatus: 'grace', vestedThrough: null })).toBe(true);
    expect(canRestore({ accessStatus: 'lapsed', vestedThrough })).toBe(true);
    expect(canRestore({ accessStatus: 'lapsed', vestedThrough: null })).toBe(false);
  });
});
