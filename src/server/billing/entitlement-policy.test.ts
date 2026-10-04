import { describe, expect, it } from 'vitest';
import type { Entitlement, Payment, PaymentAdjustment, SubscriptionState } from '@/server/db/billing-store';
import {
  addMonths,
  canRestore,
  computeEntitlement,
  currentAccess,
  coversRelease,
  type EntitlementInput,
  mayUseRelease,
  wholeMonths,
} from './entitlement-policy';

// The owner's rule (plans-and-investigations/Tenantry-Licensing-And-Feed-Plan.md, "vesting follows the money kept"):
// a payment counts for the part of its billing period that the money still kept from it pays for, as things stand
// now; 12 months of continuous counted time vest, through the end of the counted time already served.

const date = (iso: string) => new Date(iso);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

let transactions = 0;

/** One payment for `months` months from `start`, charged 3900 a month or 39000 a year before tax. */
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
    charged: months >= 12 ? 39000 : 3900,
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

/**
 * An approved adjustment of `of`, returning `amount` of what it charged before tax (all of it unless given): a refund,
 * credit or chargeback, or a reversal of one.
 */
function adjustment(
  of: Payment,
  action: string,
  approvedAt: string,
  options: Partial<PaymentAdjustment> = {},
): PaymentAdjustment {
  adjustments += 1;
  const amount = options.amount ?? of.charged;
  return {
    adjustmentId: `adj_${adjustments}`,
    transactionId: of.transactionId,
    action,
    type: amount >= of.charged ? 'full' : 'partial',
    itemTypes: [amount >= of.charged ? 'full' : 'partial'],
    status: 'approved',
    approvedAt: date(approvedAt),
    reversedAt: null,
    amount,
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
function compute(input: Omit<Partial<EntitlementInput>, 'now'> & { now: string; endedAt?: string }): Entitlement {
  const { now, endedAt, ...rest } = input;

  return computeEntitlement({
    payments: [],
    adjustments: [],
    subscriptions: [endedAt ? ended('sub_1', endedAt) : running()],
    proProductId: PRO,
    ...rest,
    now: date(now),
  });
}

const vested = (entitlement: Entitlement) => iso(entitlement.vestedThrough);
const confirmedRuns = (entitlement: Entitlement) =>
  entitlement.grants.filter((grant) => grant.kind === 'qualifying_run' && grant.status === 'confirmed');

describe('the owner’s table', () => {
  describe('12 monthly payments kept', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12);

    it.each([
      ['2027-12-01T00:00:00Z', null],
      ['2027-12-31T23:59:59Z', null],
      ['2028-01-01T00:00:00Z', '2028-01-01T00:00:00.000Z'],
      ['2028-03-01T00:00:00Z', '2028-01-01T00:00:00.000Z'],
    ])('at %s, vested through %s', (now, through) => {
      expect(vested(compute({ payments, now }))).toBe(through);
    });

    it('vests at 12 months, through the end of the time served, advancing while payments continue', () => {
      const more = monthly('2027-01-01T00:00:00Z', 15);

      expect(confirmedRuns(compute({ payments: more, now: '2028-01-01T00:00:00Z' }))).toEqual([
        expect.objectContaining({
          startedAt: date('2027-01-01T00:00:00Z'),
          confirmedAt: date('2028-01-01T00:00:00Z'),
          vestedThrough: date('2028-01-01T00:00:00Z'),
        }),
      ]);
      expect(vested(compute({ payments: more, now: '2028-02-10T06:00:00Z' }))).toBe('2028-02-10T06:00:00.000Z');
      // Never past the time paid for.
      expect(vested(compute({ payments: more, now: '2029-01-01T00:00:00Z' }))).toBe('2028-04-01T00:00:00.000Z');
    });
  });

  describe('month 6 refunded 50%', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 18);
    const half = adjustment(payments[5], 'refund', '2027-06-10T00:00:00Z', { amount: 1950 });

    it('counts half of month 6, so the qualifying period breaks there and a new one starts at month 7', () => {
      // June has 30 days: the first 15 are counted.
      const at = compute({ payments, adjustments: [half], now: '2028-01-15T00:00:00Z' });

      expect(at.vestedThrough).toBeNull();
      expect(at.run).toMatchObject({ startedAt: date('2027-07-01T00:00:00Z'), monthsPaid: 12 });
      expect(at.paymentStatuses[payments[5].transactionId]).toBe('partially_refunded');
    });

    it.each([
      ['2027-06-20T00:00:00Z', null],
      ['2028-06-30T00:00:00Z', null],
      ['2028-07-01T00:00:00Z', '2028-07-01T00:00:00.000Z'],
    ])('at %s, vested through %s', (now, through) => {
      expect(vested(compute({ payments, adjustments: [half], now }))).toBe(through);
    });

    it('counts exactly the first half of the month', () => {
      // Only months 1 to 6 paid, with no access left: the counted time is visible as the period that has not vested.
      const six = payments.slice(0, 6);
      const atEnd = compute({ payments: six, adjustments: [half], now: '2027-06-10T00:00:00Z' });

      expect(atEnd.run?.paidThrough).toEqual(date('2027-06-16T00:00:00Z'));
    });
  });

  it('counts nothing of month 6 refunded in two partial refunds of 50%', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 18);
    const refunds = [
      adjustment(payments[5], 'refund', '2027-06-10T00:00:00Z', { amount: 1950 }),
      adjustment(payments[5], 'refund', '2027-06-12T00:00:00Z', { amount: 1950 }),
    ];

    const entitlement = compute({ payments: payments.slice(0, 6), adjustments: refunds, now: '2027-06-13T00:00:00Z' });

    expect(entitlement.run?.paidThrough).toEqual(date('2027-06-01T00:00:00Z'));
    expect(entitlement.paymentStatuses[payments[5].transactionId]).toBe('refunded');
    expect(compute({ payments, adjustments: refunds, now: '2028-01-15T00:00:00Z' }).run?.startedAt).toEqual(
      date('2027-07-01T00:00:00Z'),
    );
  });

  describe('12 months vested, then money returned', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12);

    it('is not vested once month 12 is refunded in full, with 11 months counted', () => {
      const before = compute({ payments, now: '2028-01-02T00:00:00Z' });
      const refund = adjustment(payments[11], 'refund', '2028-01-02T00:00:00Z');
      const after = compute({ payments, adjustments: [refund], now: '2028-01-03T00:00:00Z' });

      expect(vested(before)).toBe('2028-01-01T00:00:00.000Z');
      expect(after.vestedThrough).toBeNull();
      expect(after.grants).toEqual([]);
      expect(compute({ payments, adjustments: [refund], now: '2027-12-15T00:00:00Z' }).run).toMatchObject({
        paidThrough: date('2027-12-01T00:00:00Z'),
        monthsPaid: 11,
      });
    });

    it('restarts the qualifying period at month 4 once month 3 is refunded in full', () => {
      const longer = monthly('2027-01-01T00:00:00Z', 15);
      const refund = adjustment(longer[2], 'refund', '2028-01-20T00:00:00Z');

      expect(vested(compute({ payments: longer, now: '2028-01-19T00:00:00Z' }))).toBe('2028-01-19T00:00:00.000Z');
      const after = compute({ payments: longer, adjustments: [refund], now: '2028-03-15T00:00:00Z' });
      expect(after.vestedThrough).toBeNull();
      expect(after.run).toMatchObject({
        startedAt: date('2027-04-01T00:00:00Z'),
        vestsAt: date('2028-04-01T00:00:00Z'),
      });
    });
  });

  describe('annual plans', () => {
    const term = annual('2027-01-01T00:00:00Z');

    it.each([
      ['2027-06-01T00:00:00Z', 'conditional', null],
      ['2027-12-31T23:59:59Z', 'conditional', null],
      ['2028-01-01T00:00:00Z', 'confirmed', '2028-01-01T00:00:00.000Z'],
      ['2029-01-01T00:00:00Z', 'confirmed', '2028-01-01T00:00:00.000Z'],
    ])('kept to the term end: at %s the grant is %s, vested through %s', (now, status, through) => {
      const entitlement = compute({ payments: [term], now });

      expect(entitlement.grants.find((grant) => grant.kind === 'annual_term')).toMatchObject({ status });
      expect(vested(entitlement)).toBe(through);
      if (status === 'conditional') expect(iso(entitlement.conditionalThrough)).toBe('2028-01-01T00:00:00.000Z');
    });

    it('refunded in full after the term ended: grant withdrawn, nothing counted', () => {
      const refund = adjustment(term, 'refund', '2028-02-01T00:00:00Z');
      const entitlement = compute({ payments: [term], adjustments: [refund], now: '2028-03-01T00:00:00Z' });

      expect(entitlement.vestedThrough).toBeNull();
      expect(entitlement.grants).toEqual([
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
      ]);
      expect(compute({ payments: [term], adjustments: [refund], now: '2027-06-01T00:00:00Z' }).run).toBeNull();
    });

    it('refunded 50% in month 3: grant withdrawn, six months counted from the start', () => {
      const refund = adjustment(term, 'refund', '2027-03-15T00:00:00Z', { amount: 19500 });
      const entitlement = compute({ payments: [term], adjustments: [refund], now: '2027-04-01T00:00:00Z' });

      expect(entitlement.grants).toEqual([expect.objectContaining({ kind: 'annual_term', status: 'withdrawn' })]);
      // Half of 365 days.
      expect(entitlement.run).toMatchObject({ paidThrough: date('2027-07-02T12:00:00Z'), monthsPaid: 6 });
    });

    it('refunded 10% in month 11: grant withdrawn, about 10.8 months counted', () => {
      const refund = adjustment(term, 'refund', '2027-11-10T00:00:00Z', { amount: 3900 });
      const entitlement = compute({ payments: [term], adjustments: [refund], now: '2027-11-11T00:00:00Z' });

      expect(entitlement.grants).toEqual([expect.objectContaining({ status: 'withdrawn' })]);
      // 90% of 365 days is 328.5 days: to 25 November 12:00, 10 whole months and most of the 11th.
      expect(entitlement.run).toMatchObject({ paidThrough: date('2027-11-25T12:00:00Z'), monthsPaid: 10 });
      expect(entitlement.vestedThrough).toBeNull();
    });

    it('credited for the unserved part on a switch to monthly: the kept part counts and the monthly periods continue it', () => {
      // Monthly from January 2027; annual from 1 July 2027 (a 366-day term); switched back to monthly on 1 October
      // 2027, when Paddle credits the 274 unserved days of the term, rounded to the penny, and monthly billing resumes.
      const before = monthly('2027-01-01T00:00:00Z', 6);
      const switched = annual('2027-07-01T00:00:00Z');
      const credit = adjustment(switched, 'credit', '2027-10-01T00:00:00Z', {
        amount: Math.round((39000 * 274) / 366),
        itemTypes: ['proration'],
      });
      const after = monthly('2027-10-01T00:00:00Z', 6);

      const entitlement = compute({
        payments: [...before, switched, ...after],
        adjustments: [credit],
        now: '2028-03-15T00:00:00Z',
      });

      expect(vested(entitlement)).toBe('2028-03-15T00:00:00.000Z');
      expect(entitlement.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z') });
      expect(entitlement.grants).toContainEqual(
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
      );
    });

    it('breaks the qualifying period where the monthly periods do not start where the counted time ends', () => {
      const switched = annual('2027-01-01T00:00:00Z');
      // Half credited on 1 April: the kept money pays to early July, and monthly billing starts on 1 April.
      const credit = adjustment(switched, 'credit', '2027-04-01T00:00:00Z', { amount: 19500 });
      const later = monthly('2027-08-01T00:00:00Z', 6);

      const entitlement = compute({
        payments: [switched, ...later],
        adjustments: [credit],
        now: '2027-12-01T00:00:00Z',
      });

      expect(entitlement.run).toMatchObject({ startedAt: date('2027-08-01T00:00:00Z') });
    });
  });

  describe('a chargeback after vesting, then reversed', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 13);
    const chargeback = adjustment(payments[3], 'chargeback', '2028-01-20T00:00:00Z');

    it('is not vested after the chargeback', () => {
      const entitlement = compute({ payments, adjustments: [chargeback], now: '2028-02-01T00:00:00Z' });

      expect(entitlement.vestedThrough).toBeNull();
      expect(entitlement.paymentStatuses[payments[3].transactionId]).toBe('charged_back');
    });

    it.each([
      [
        'a chargeback_reverse adjustment',
        [chargeback, adjustment(payments[3], 'chargeback_reverse', '2028-01-25T00:00:00Z')],
      ],
      [
        'the chargeback marked reversed',
        [{ ...chargeback, status: 'reversed', reversedAt: date('2028-01-25T00:00:00Z') }],
      ],
      [
        'both',
        [
          { ...chargeback, status: 'reversed', reversedAt: date('2028-01-25T00:00:00Z') },
          adjustment(payments[3], 'chargeback_reverse', '2028-01-25T00:00:00Z'),
        ],
      ],
    ])('is vested again once it is reversed, by %s', (_, made) => {
      const entitlement = compute({ payments, adjustments: made, now: '2028-02-01T00:00:00Z' });

      expect(vested(entitlement)).toBe('2028-02-01T00:00:00.000Z');
      expect(entitlement.paymentStatuses[payments[3].transactionId]).toBe('paid');
    });
  });

  it.each([
    ['a trial', 0],
    ['a 100% discounted month', 0],
  ])('counts nothing for %s', (_, charged) => {
    const free = payment('2027-01-01T00:00:00Z', { charged });
    const payments = [free, ...monthly('2027-02-01T00:00:00Z', 12)];

    expect(compute({ payments, now: '2028-01-15T00:00:00Z' }).vestedThrough).toBeNull();
    expect(vested(compute({ payments, now: '2028-02-01T00:00:00Z' }))).toBe('2028-02-01T00:00:00.000Z');
  });

  it('counts a month bought with a 50% discount coupon in full', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12, { charged: 1950 });

    expect(vested(compute({ payments, now: '2028-01-01T00:00:00Z' }))).toBe('2028-01-01T00:00:00.000Z');
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
  const comeback = (count: number) => monthly('2028-06-01T00:00:00Z', count, { subscriptionId: 'sub_2' });

  it('vests through the end of 2027, covering v1.4, and keeps it after cancelling', () => {
    const entitlement = compute({ payments: firstRun, subscriptions: [firstEnd], now: '2028-01-20T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
    expect(entitlement.run).toBeNull();
    expect(coversRelease(entitlement.vestedThrough, v14)).toBe(true);
  });

  it('starts a new qualifying period on return, and keeps no right to v1.6 after cancelling again', () => {
    const back = compute({
      payments: [...firstRun, ...comeback(1)],
      subscriptions: [firstEnd, running('sub_2')],
      now: '2028-06-10T00:00:00Z',
    });
    expect(back.run).toMatchObject({ startedAt: date('2028-06-01T00:00:00Z'), monthsPaid: 1 });

    const gone = compute({
      payments: [...firstRun, ...comeback(2)],
      subscriptions: [firstEnd, ended('sub_2', '2028-08-01T00:00:00Z')],
      now: '2028-09-01T00:00:00Z',
    });
    expect(vested(gone)).toBe('2028-01-01T00:00:00.000Z');
    expect(coversRelease(gone.vestedThrough, v16)).toBe(false);
  });

  it('vests through May 2029, including v1.5 from the gap, if they stay to the end of May 2029', () => {
    const entitlement = compute({
      payments: [...firstRun, ...comeback(12)],
      subscriptions: [firstEnd, running('sub_2')],
      now: '2029-06-01T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2029-06-01T00:00:00.000Z');
    expect(coversRelease(entitlement.vestedThrough, v15)).toBe(true);
  });
});

describe('a subscription ending with its payment kept in full', () => {
  it('counts the whole paid period, though the subscription was cancelled before it ended', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12);

    // Cancelled at once on 10 December, nothing refunded: December was paid for, so it counts.
    const entitlement = compute({ payments, now: '2028-01-05T00:00:00Z', endedAt: '2027-12-10T00:00:00Z' });

    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('confirms an annual grant at the term end though the subscription ended mid-term, the money kept', () => {
    const term = annual('2027-01-01T00:00:00Z');

    const during = compute({ payments: [term], now: '2027-09-01T00:00:00Z', endedAt: '2027-05-01T00:00:00Z' });
    expect(during.grants).toEqual([expect.objectContaining({ kind: 'annual_term', status: 'conditional' })]);
    expect(vested(compute({ payments: [term], now: '2028-01-01T00:00:00Z', endedAt: '2027-05-01T00:00:00Z' }))).toBe(
      '2028-01-01T00:00:00.000Z',
    );
  });

  it('counts a period paused part-way, and the resumed period that overlaps it, once', () => {
    const before = monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' });
    // Paused on 15 June with June kept; resumed on 20 June, when Paddle bills a new period from the resumption.
    const after = monthly('2027-06-20T00:00:00Z', 7, { subscriptionId: 'sub_2' });

    const entitlement = compute({
      payments: [...before, ...after],
      subscriptions: [ended('sub_1', '2027-06-15T00:00:00Z', 'paused'), running('sub_2')],
      now: '2028-01-05T00:00:00Z',
    });

    expect(vested(entitlement)).toBe('2028-01-05T00:00:00.000Z');
  });
});

describe('what counts as money returned', () => {
  const payments = monthly('2027-01-01T00:00:00Z', 12);
  const now = '2028-01-01T00:00:00Z';

  it.each([
    ['pending', { status: 'pending_approval', approvedAt: null }],
    ['rejected', { status: 'rejected', approvedAt: null }],
    ['a tax-only correction', { amount: 0, itemTypes: ['tax'], type: 'partial' }],
    ['a chargeback warning', { action: 'chargeback_warning' }],
  ] as [string, Partial<PaymentAdjustment>][])('ignores a refund that is %s', (_, options) => {
    const made = adjustment(payments[4], options.action ?? 'refund', '2027-06-01T00:00:00Z', options);

    expect(vested(compute({ payments, adjustments: [made], now }))).toBe('2028-01-01T00:00:00.000Z');
  });

  it('counts a credit as money returned, and a reversed credit as money kept', () => {
    const credit = adjustment(payments[4], 'credit', '2027-06-01T00:00:00Z');
    const reversal = adjustment(payments[4], 'credit_reverse', '2027-06-05T00:00:00Z');

    expect(compute({ payments, adjustments: [credit], now }).vestedThrough).toBeNull();
    expect(vested(compute({ payments, adjustments: [credit, reversal], now }))).toBe('2028-01-01T00:00:00.000Z');
  });

  it('restores nothing with a reversal larger than what it reverses, or of another kind of adjustment', () => {
    const refund = adjustment(payments[4], 'refund', '2027-06-01T00:00:00Z');
    const unrelated = adjustment(payments[4], 'chargeback_reverse', '2027-06-05T00:00:00Z', { amount: 99999 });
    const chargeback = adjustment(payments[6], 'chargeback', '2027-08-01T00:00:00Z', { amount: 1000 });
    const tooLarge = adjustment(payments[6], 'chargeback_reverse', '2027-08-05T00:00:00Z', { amount: 99999 });
    const otherRefund = adjustment(payments[6], 'refund', '2027-08-06T00:00:00Z');

    expect(compute({ payments, adjustments: [refund, unrelated], now }).vestedThrough).toBeNull();
    expect(compute({ payments, adjustments: [chargeback, tooLarge, otherRefund], now }).vestedThrough).toBeNull();
  });

  it('treats an adjustment of unknown amount as returning everything, unless it is tax only', () => {
    const unknown = adjustment(payments[4], 'refund', '2027-06-01T00:00:00Z', { amount: null, type: 'partial' });
    const unknownTax = adjustment(payments[4], 'refund', '2027-06-01T00:00:00Z', {
      amount: null,
      type: 'partial',
      itemTypes: ['tax'],
    });

    expect(compute({ payments, adjustments: [unknown], now }).vestedThrough).toBeNull();
    expect(vested(compute({ payments, adjustments: [unknownTax], now }))).toBe('2028-01-01T00:00:00.000Z');
  });

  it('counts overlapping periods of two subscriptions once, and keeps the time one of them still pays for', () => {
    const first = monthly('2027-01-01T00:00:00Z', 12, { subscriptionId: 'sub_1' });
    const second = monthly('2027-01-10T00:00:00Z', 12, { subscriptionId: 'sub_2' });
    const refunds = first.map((paid) => adjustment(paid, 'refund', '2027-02-01T00:00:00Z'));

    const entitlement = compute({
      payments: [...first, ...second],
      adjustments: refunds,
      subscriptions: [running('sub_1'), running('sub_2')],
      now: '2028-01-10T00:00:00Z',
    });

    expect(confirmedRuns(entitlement)).toEqual([expect.objectContaining({ startedAt: date('2027-01-10T00:00:00Z') })]);
  });
});

describe('attempts to vest more than the money kept pays for', () => {
  const payments = monthly('2027-01-01T00:00:00Z', 12);
  const now = '2028-01-05T00:00:00Z';

  it('returns everything for an adjustment Paddle calls full, whatever its amount', () => {
    const pennyShort = adjustment(payments[11], 'refund', '2027-12-02T00:00:00Z', { amount: 3899, type: 'full' });
    const entitlement = compute({ payments, adjustments: [pennyShort], now: '2027-12-10T00:00:00Z' });

    expect(entitlement.run?.paidThrough).toEqual(date('2027-12-01T00:00:00Z'));
    expect(entitlement.paymentStatuses[payments[11].transactionId]).toBe('refunded');
  });

  it('counts an approved refund as returned even without a recorded approval time', () => {
    const undated = adjustment(payments[4], 'refund', '2027-06-01T00:00:00Z', { approvedAt: null });

    expect(compute({ payments, adjustments: [undated], now }).vestedThrough).toBeNull();
  });

  it('counts several partial refunds, credits and chargebacks of one payment together, never below nothing', () => {
    const made = [
      adjustment(payments[4], 'refund', '2027-06-01T00:00:00Z', { amount: 1000 }),
      adjustment(payments[4], 'credit', '2027-06-02T00:00:00Z', { amount: 1000 }),
      adjustment(payments[4], 'chargeback', '2027-06-03T00:00:00Z', { amount: 1000 }),
      adjustment(payments[4], 'refund', '2027-06-04T00:00:00Z', { amount: 5000 }),
    ];

    const entitlement = compute({ payments, adjustments: made, now });
    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.paymentStatuses[payments[4].transactionId]).toBe('charged_back');
  });

  it('restores no more with two records of one reversal than with one', () => {
    const chargeback = adjustment(payments[4], 'chargeback', '2027-06-01T00:00:00Z', { amount: 2000 });
    const refund = adjustment(payments[4], 'refund', '2027-06-02T00:00:00Z', { amount: 1900 });
    const reversal = adjustment(payments[4], 'chargeback_reverse', '2027-06-05T00:00:00Z', { amount: 2000 });
    const marked = { ...chargeback, status: 'reversed', reversedAt: date('2027-06-05T00:00:00Z') };

    // The refund still returns 1900 of 3900: half the month is gone, so nothing vests.
    for (const made of [
      [chargeback, refund, reversal],
      [marked, refund, reversal],
      [marked, refund],
    ]) {
      expect(compute({ payments, adjustments: made, now }).vestedThrough).toBeNull();
    }
  });

  it('gains nothing from a second subscription refunded in full, or from overlapping kept periods', () => {
    const second = monthly('2027-01-15T00:00:00Z', 6, { subscriptionId: 'sub_2' });
    const refunded = second.map((paid) => adjustment(paid, 'refund', '2027-02-01T00:00:00Z'));
    const gap = payments.filter((_, i) => i !== 6);

    const entitlement = compute({
      payments: [...gap, ...second],
      adjustments: refunded,
      subscriptions: [running('sub_1'), running('sub_2')],
      now,
    });

    expect(entitlement.vestedThrough).toBeNull();
  });

  it('counts a period paid again by a resumption or plan change once, so paying twice for a month vests no sooner', () => {
    const doubled = [...payments.slice(0, 11), payment('2027-11-01T00:00:00Z', { subscriptionId: 'sub_2' })];

    expect(compute({ payments: doubled, now: '2027-12-15T00:00:00Z' }).vestedThrough).toBeNull();
  });

  it('never counts time not yet served, however much is paid ahead', () => {
    const ahead = [...payments, ...monthly('2028-01-01T00:00:00Z', 24)];

    expect(vested(compute({ payments: ahead, now: '2028-02-01T00:00:00Z' }))).toBe('2028-02-01T00:00:00.000Z');
  });
});

describe('attempts to take vested time from a customer whose money was kept', () => {
  const payments = monthly('2027-01-01T00:00:00Z', 12);
  const now = '2028-01-05T00:00:00Z';

  it.each([
    ['cancelling straight after', { endedAt: '2028-01-01T00:00:00Z' }],
    ['cancelling mid-period', { endedAt: '2027-12-15T00:00:00Z' }],
    [
      'a tax-only correction',
      {
        adjustments: [
          adjustment(payments[3], 'refund', '2027-05-01T00:00:00Z', { amount: 0, type: 'partial', itemTypes: ['tax'] }),
        ],
      },
    ],
    [
      'a refund that was rejected',
      {
        adjustments: [
          adjustment(payments[3], 'refund', '2027-05-01T00:00:00Z', { status: 'rejected', approvedAt: null }),
        ],
      },
    ],
    ['a chargeback warning', { adjustments: [adjustment(payments[3], 'chargeback_warning', '2027-05-01T00:00:00Z')] }],
    [
      'a reversal with nothing to reverse',
      { adjustments: [adjustment(payments[3], 'credit_reverse', '2027-05-01T00:00:00Z')] },
    ],
  ] as [string, Omit<Partial<EntitlementInput>, 'now'> & { endedAt?: string }][])('keeps it through %s', (_, extra) => {
    expect(vested(compute({ payments, now, ...extra }))).toBe('2028-01-01T00:00:00.000Z');
  });
});

describe('timing', () => {
  it('allows timestamp jitter between periods, but a gap of one day breaks the qualifying period', () => {
    const jitter = monthly('2027-01-01T00:00:00Z', 6).concat(monthly('2027-07-01T00:30:00Z', 6));
    expect(compute({ payments: jitter, now: '2028-01-02T00:00:00Z' }).vestedThrough).not.toBeNull();

    const gap = monthly('2027-01-01T00:00:00Z', 6).concat(monthly('2027-07-02T00:00:00Z', 6));
    const entitlement = compute({ payments: gap, now: '2028-01-03T00:00:00Z' });
    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.run).toMatchObject({ startedAt: date('2027-07-02T00:00:00Z'), monthsPaid: 6 });
  });

  it('vests a period started on the 31st whose month-end periods fall a few days short of 12 months', () => {
    // Paddle may bill 31 January, 28 February, 28 March, … (paddle-assumptions.ts).
    let start = date('2027-01-31T09:00:00Z');
    const payments = [];
    for (let i = 0; i < 12; i++) {
      const end = i === 0 ? date('2027-02-28T09:00:00Z') : addMonths(start, 1);
      payments.push(payment(start.toISOString(), { periodEndsAt: end }));
      start = end;
    }

    expect(vested(compute({ payments, now: '2028-01-28T09:00:00Z' }))).toBe('2028-01-28T09:00:00.000Z');

    // The allowance is for a period that counts in full: one partly refunded must reach the full 12 months.
    const refund = adjustment(payments[11], 'refund', '2028-01-20T00:00:00Z', { amount: 10 });
    expect(compute({ payments, adjustments: [refund], now: '2028-02-15T00:00:00Z' }).vestedThrough).toBeNull();
  });

  it.each(['2027-06-01T00:00:00Z', '2027-12-28T00:00:00Z', '2027-12-29T00:00:00Z', '2027-12-31T23:00:00Z'])(
    'gives no rights to a first annual term with any of its money returned, whenever: %s',
    (at) => {
      const term = annual('2027-01-01T00:00:00Z');
      const refund = adjustment(term, 'refund', at, { amount: 100 });

      expect(
        compute({ payments: [term], adjustments: [refund], now: '2028-02-01T00:00:00Z' }).vestedThrough,
      ).toBeNull();
    },
  );

  it('shows no current qualifying period for a customer whose last counted time ended more than a grace period ago', () => {
    expect(compute({ payments: monthly('2027-01-01T00:00:00Z', 3), now: '2027-05-15T00:00:00Z' }).run).toBeNull();
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
    const pastDue = running('sub_1', 'past_due', '2026-10-01T00:00:00Z');

    expect(access([pastDue], date('2026-10-30T23:59:59Z')).status).toBe('grace');
    expect(access([pastDue], date('2026-10-31T00:00:00Z')).status).toBe('lapsed');
    expect(access([pastDue, running('sub_2')], date('2026-10-31T00:00:00Z')).status).toBe('active');
    // With no recorded start, grace cannot be shown to be running: it has ended, so a missing date never extends it.
    expect(access([running('sub_1', 'past_due')])).toEqual({ status: 'lapsed', graceEndsAt: null });
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

  // Monthly payments at one price, with gaps, overlaps, free periods, the odd annual term, and refunds, credits and
  // chargebacks of random amounts, some of them reversed.
  function history(seed: number, { reversals = true }: { reversals?: boolean } = {}) {
    const next = random(seed);
    const payments: Payment[] = [];
    const made: PaymentAdjustment[] = [];
    let start = date('2027-01-01T00:00:00Z');

    for (let i = 0; i < 30; i++) {
      const roll = next();
      if (roll < 0.1) start = new Date(start.getTime() + (1 + Math.floor(next() * 40)) * DAY);
      else if (roll < 0.15) start = new Date(start.getTime() - Math.floor(next() * 10) * DAY);
      const months = next() < 0.1 ? 12 : 1;
      const charged = next() < 0.05 ? 0 : months * 3900;
      const paid = payment(start.toISOString(), { months, charged, subscriptionId: next() < 0.2 ? 'sub_2' : 'sub_1' });
      payments.push(paid);
      if (charged > 0 && next() < 0.2) {
        const action = ['refund', 'credit', 'chargeback'][Math.floor(next() * 3)];
        const amount = next() < 0.4 ? charged : Math.max(1, Math.floor(next() * charged));
        const at = new Date(paid.periodStartsAt.getTime() + Math.floor(next() * 400) * DAY);
        made.push(adjustment(paid, action, at.toISOString(), { amount }));
        if (reversals && action !== 'refund' && next() < 0.3) {
          made.push(adjustment(paid, `${action}_reverse`, new Date(at.getTime() + DAY).toISOString(), { amount }));
        }
      }
      start = paid.periodEndsAt;
    }

    return { payments, adjustments: made };
  }

  function shuffle<T>(items: T[], next: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // The time the kept money pays for, payment by payment, independently of the module: the first kept fraction of each
  // period. Only for histories without reversals.
  function keptSegments(payments: Payment[], made: PaymentAdjustment[]): [number, number][] {
    return payments.flatMap((paid) => {
      if (paid.charged <= 0) return [];
      const returned = made
        .filter((a) => a.transactionId === paid.transactionId)
        .reduce((sum, a) => sum + (a.amount ?? paid.charged), 0);
      const kept = Math.max(0, (paid.charged - returned) / paid.charged);
      const startsAt = paid.periodStartsAt.getTime();
      return kept > 0
        ? [[startsAt, startsAt + kept * (paid.periodEndsAt.getTime() - startsAt)] as [number, number]]
        : [];
    });
  }

  // How much of [from, to) the segments cover.
  function covered(segments: [number, number][], from: number, to: number): number {
    const clipped = segments
      .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let reach = from;
    for (const [a, b] of clipped) {
      if (b <= reach) continue;
      total += b - Math.max(a, reach);
      reach = b;
    }
    return total;
  }

  // The time vested: each confirmed qualifying period from its start to its vested-through date.
  const vestedTime = (entitlement: Entitlement) =>
    confirmedRuns(entitlement).reduce((sum, g) => sum + (g.vestedThrough.getTime() - g.startedAt.getTime()), 0);

  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const nows = ['2027-09-01T00:00:00Z', '2028-06-01T00:00:00Z', '2030-01-01T00:00:00Z'];

  it.each(seeds)('does not depend on the order events were recorded in (seed %i)', (seed) => {
    const { payments, adjustments: made } = history(seed);
    const next = random(seed + 1000);

    for (const now of nows) {
      expect(compute({ payments: shuffle(payments, next), adjustments: shuffle(made, next), now })).toEqual(
        compute({ payments, adjustments: made, now }),
      );
    }
  });

  it.each(seeds)('never vests more time than the kept money pays for and has been served (seed %i)', (seed) => {
    const { payments, adjustments: made } = history(seed, { reversals: false });
    const segments = keptSegments(payments, made);

    for (const now of nows) {
      const entitlement = compute({ payments, adjustments: made, now });
      expect(entitlement.vestedThrough?.getTime() ?? 0).toBeLessThanOrEqual(date(now).getTime());

      for (const grant of confirmedRuns(entitlement)) {
        const from = grant.startedAt.getTime();
        const to = grant.vestedThrough.getTime();
        // Continuous counted time: gaps of at most the hour the continuity rule allows, one per period.
        expect(covered(segments, from, to)).toBeGreaterThanOrEqual(to - from - payments.length * HOUR);
        expect(to - from).toBeGreaterThanOrEqual(365 * DAY - 3 * DAY);
      }
    }
  });

  it.each(seeds)('never vests more because money was returned (seed %i)', (seed) => {
    const { payments, adjustments: made } = history(seed, { reversals: false });
    const next = random(seed + 2000);
    const charged = payments.filter((paid) => paid.charged > 0);
    const target = charged[Math.floor(next() * charged.length)];
    const extra = adjustment(target, 'refund', '2027-06-01T00:00:00Z', {
      amount: Math.max(1, Math.floor(next() * target.charged)),
    });

    for (const now of nows) {
      const before = compute({ payments, adjustments: made, now });
      const after = compute({ payments, adjustments: [...made, extra], now });

      expect(after.vestedThrough?.getTime() ?? 0).toBeLessThanOrEqual(before.vestedThrough?.getTime() ?? 0);
      expect(vestedTime(after)).toBeLessThanOrEqual(vestedTime(before));
    }
  });

  it.each(seeds)('vests nothing once everything is returned (seed %i)', (seed) => {
    const { payments, adjustments: made } = history(seed);
    const everything = payments.map((paid) => adjustment(paid, 'refund', '2027-01-01T00:00:00Z'));

    for (const now of nows) {
      const entitlement = compute({ payments, adjustments: [...made, ...everything], now });
      expect(entitlement.vestedThrough).toBeNull();
      expect(entitlement.grants.filter((grant) => grant.status !== 'withdrawn')).toEqual([]);
    }
  });

  it.each(seeds)('never vests more than the share of the paid time the kept money pays for (seed %i)', (seed) => {
    // Monthly payments only, at one price, so money and time are in proportion.
    const { payments, adjustments: made } = history(seed, { reversals: false });
    const months = payments.filter((paid) => paid.billingInterval === 'month' && paid.charged > 0);
    const kept = made.filter((a) => months.some((paid) => paid.transactionId === a.transactionId));
    const paidFor = months.reduce(
      (sum, paid) => sum + (paid.periodEndsAt.getTime() - paid.periodStartsAt.getTime()),
      0,
    );
    const keptFor = keptSegments(months, kept).reduce((sum, [a, b]) => sum + (b - a), 0);

    const entitlement = compute({ payments: months, adjustments: kept, now: '2030-01-01T00:00:00Z' });

    expect(vestedTime(entitlement)).toBeLessThanOrEqual(keptFor + months.length * HOUR);
    expect(keptFor).toBeLessThanOrEqual(paidFor);
  });
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
