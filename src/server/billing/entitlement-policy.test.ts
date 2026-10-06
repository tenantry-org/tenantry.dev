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
  monthsOf,
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
    priceId: months >= 12 ? 'pri_01year' : 'pri_01month',
    currencyCode: 'GBP',
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
    currencyCode: of.currencyCode,
    ...options,
  };
}

const PRO = 'pro_01';
const OFFER_PRICES = ['pri_01month', 'pri_01year'];

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
    offerPriceIds: OFFER_PRICES,
    ...rest,
    now: date(now),
  });
}

const vested = (entitlement: Entitlement) => iso(entitlement.vestedThrough);
const confirmedRuns = (entitlement: Entitlement) =>
  entitlement.grants.filter((grant) => grant.kind === 'paid_time' && grant.status === 'confirmed');

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

    it('counts half of month 6, and paid time adds up past it: it vests halfway through month 13', () => {
      // June counts half a month: 11 and a half paid months at the end of December, and the twelfth reached halfway
      // through January 2028, 15 and a half of its 31 days in.
      const at = compute({ payments, adjustments: [half], now: '2028-01-15T00:00:00Z' });

      expect(at.vestedThrough).toBeNull();
      expect(at.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), vestsAt: date('2028-01-16T12:00:00Z') });
      expect(at.paymentStatuses[payments[5].transactionId]).toBe('partially_refunded');
    });

    it.each([
      ['2027-06-20T00:00:00Z', null],
      ['2028-01-16T11:59:59Z', null],
      // Vested through the end of the paid time served: the moment 12 months of it are served, then on with it.
      ['2028-01-16T12:00:00Z', '2028-01-16T12:00:00.000Z'],
      ['2028-03-01T00:00:00Z', '2028-03-01T00:00:00.000Z'],
      // All 18 months served: the end of the last paid month.
      ['2028-09-01T00:00:00Z', '2028-07-01T00:00:00.000Z'],
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
    // June adds no time: the twelfth paid month is January 2028.
    expect(compute({ payments, adjustments: refunds, now: '2028-01-15T00:00:00Z' }).run).toMatchObject({
      startedAt: date('2027-01-01T00:00:00Z'),
      vestsAt: date('2028-02-01T00:00:00Z'),
    });
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

    it('takes March away once month 3 is refunded in full, and vests again once 12 months are counted', () => {
      const longer = monthly('2027-01-01T00:00:00Z', 15);
      const refund = adjustment(longer[2], 'refund', '2028-01-20T00:00:00Z');

      expect(vested(compute({ payments: longer, now: '2028-01-19T00:00:00Z' }))).toBe('2028-01-19T00:00:00.000Z');
      const after = compute({ payments: longer, adjustments: [refund], now: '2028-01-20T00:00:00Z' });
      expect(after.vestedThrough).toBeNull();
      // March's 31 days are not counted: 365 days are counted on 1 February 2028.
      expect(after.run).toMatchObject({
        startedAt: date('2027-01-01T00:00:00Z'),
        vestsAt: date('2028-02-01T00:00:00Z'),
      });
      // Then vested through the end of the paid time served.
      expect(vested(compute({ payments: longer, adjustments: [refund], now: '2028-03-15T00:00:00Z' }))).toBe(
        '2028-03-15T00:00:00.000Z',
      );
    });
  });

  describe('annual plans', () => {
    const term = annual('2027-01-01T00:00:00Z');

    describe('a charge within a paid billing period, such as a prorated top-up', () => {
      const halfTerm = (charged = 500) =>
        payment('2027-07-01T00:00:00Z', {
          months: 6,
          billingInterval: 'year',
          billingFrequency: 1,
          priceId: 'pri_01year',
          charged,
        });
      const at = (payments: Payment[], adjustments: PaymentAdjustment[], now: string, endedAt?: string) =>
        compute({ payments, adjustments, now, endedAt });

      it.each([
        ['the whole year', () => annual('2027-01-01T00:00:00Z', { charged: 500 })],
        ['the second half of the year', () => halfTerm()],
      ])('adds no time when stamped with %s, kept after the main payment is refunded', (_, topUp) => {
        const refund = adjustment(term, 'refund', '2027-07-02T00:00:00Z');
        for (const now of ['2027-07-03T00:00:00Z', '2028-02-01T00:00:00Z', '2030-01-01T00:00:00Z']) {
          const entitlement = at([term, topUp()], [refund], now, '2027-07-02T00:00:00Z');
          expect(entitlement.vestedThrough).toBeNull();
          expect(confirmedRuns(entitlement)).toEqual([]);
        }
        // Its 500 of the 39500 charged for the year pays for the first few days of it, and no more.
        const kept = Math.floor((500 / 39500) * 365 * DAY);
        expect(at([term, topUp()], [refund], '2027-07-03T00:00:00Z').run).toMatchObject({
          paidThrough: new Date(date('2027-01-01T00:00:00Z').getTime() + kept),
          monthsPaid: 0,
        });
      });

      it('changes nothing when everything is kept: the term vests at once and its paid time is the year', () => {
        const kept = compute({ payments: [term, halfTerm()], now: '2027-09-01T00:00:00Z' });
        const alone = compute({ payments: [term], now: '2027-09-01T00:00:00Z' });

        expect(kept.vestedThrough).toEqual(alone.vestedThrough);
        expect(kept.run).toEqual(alone.run);
        expect(confirmedRuns(compute({ payments: [term, halfTerm()], now: '2028-02-01T00:00:00Z' }))).toEqual(
          confirmedRuns(compute({ payments: [term], now: '2028-02-01T00:00:00Z' })),
        );
      });

      it('takes away only its own share of the year when only the top-up is refunded', () => {
        const topUp = halfTerm(3900);
        const refund = adjustment(topUp, 'refund', '2027-07-02T00:00:00Z');
        const entitlement = compute({ payments: [term, topUp], adjustments: [refund], now: '2027-09-01T00:00:00Z' });

        // 39000 of 42900 kept: the first 39000 / 42900 of the year.
        const kept = Math.floor((39000 / 42900) * 365 * DAY);
        expect(entitlement.run?.paidThrough).toEqual(new Date(date('2027-01-01T00:00:00Z').getTime() + kept));
      });
    });

    it('grants no term for a payment at the yearly price shorter than a year: it counts only as paid time', () => {
      // A prorated charge for a plan change, at the yearly price, for the last six months of the term.
      const prorated = payment('2027-07-01T00:00:00Z', {
        months: 6,
        billingInterval: 'year',
        billingFrequency: 1,
        priceId: 'pri_01year',
        charged: 500,
      });
      const refund = adjustment(term, 'refund', '2027-07-02T00:00:00Z');
      const at = (now: string) =>
        compute({ payments: [term, prorated], adjustments: [refund], now, endedAt: '2027-07-02T00:00:00Z' });

      for (const now of ['2027-07-03T00:00:00Z', '2028-02-01T00:00:00Z']) {
        expect(at(now).vestedThrough).toBeNull();
        expect(at(now).grants).toEqual([
          expect.objectContaining({ kind: 'annual_term', transactionId: term.transactionId, status: 'withdrawn' }),
        ]);
      }
      // A year from 29 February ends on 28 February: 12 calendar months, so a whole year.
      const leapDay = annual('2028-02-29T00:00:00Z', { periodEndsAt: date('2029-02-28T00:00:00Z') });
      expect(vested(compute({ payments: [leapDay], now: '2028-03-01T00:00:00Z' }))).toBe('2029-02-28T00:00:00.000Z');
    });

    it('withdraws the term on a refund of any payment of its billing period, a top-up included, and keeps the rest as paid time', () => {
      const now = '2027-07-03T00:00:00Z';
      const annualGrants = (entitlement: Entitlement) => entitlement.grants.filter((g) => g.kind === 'annual_term');
      const topUps = [
        // Stamped with the whole year, or with its second half.
        annual('2027-01-01T00:00:00Z', { charged: 500 }),
        payment('2027-07-01T00:00:00Z', {
          months: 6,
          billingInterval: 'year',
          billingFrequency: 1,
          priceId: 'pri_01year',
          charged: 500,
        }),
      ];

      for (const topUp of topUps) {
        // The top-up refunded, the annual payment kept: withdrawn, whichever order the payments are listed in.
        const refunded = adjustment(topUp, 'refund', '2027-07-02T00:00:00Z');
        for (const payments of [
          [term, topUp],
          [topUp, term],
        ]) {
          const entitlement = compute({ payments, adjustments: [refunded], now });
          expect(entitlement.vestedThrough).toBeNull();
          expect(annualGrants(entitlement)).toEqual([
            expect.objectContaining({
              transactionId: term.transactionId,
              status: 'withdrawn',
              withdrawnReason: 'refund',
            }),
          ]);
          // 39000 of the 39500 charged for the year is kept: the first 39000 / 39500 of it, a little under 12 months.
          const kept = Math.floor((39000 / 39500) * 365 * DAY);
          expect(entitlement.run).toMatchObject({
            paidThrough: new Date(date('2027-01-01T00:00:00Z').getTime() + kept),
            monthsPaid: 11,
          });
        }

        // Charged back, then the dispute won: confirmed again.
        const chargeback = adjustment(topUp, 'chargeback', '2027-07-02T00:00:00Z');
        expect(annualGrants(compute({ payments: [term, topUp], adjustments: [chargeback], now }))).toEqual([
          expect.objectContaining({ status: 'withdrawn', withdrawnReason: 'chargeback' }),
        ]);
        const reversed = { ...chargeback, status: 'reversed', reversedAt: date('2027-07-02T12:00:00Z') };
        const restored = compute({ payments: [term, topUp], adjustments: [reversed], now });
        expect(annualGrants(restored)).toEqual([expect.objectContaining({ status: 'confirmed' })]);
        expect(vested(restored)).toBe('2028-01-01T00:00:00.000Z');

        // The annual payment refunded, the top-up kept: withdrawn too.
        const termRefunded = adjustment(term, 'refund', '2027-07-02T00:00:00Z');
        const entitlement = compute({
          payments: [term, topUp],
          adjustments: [termRefunded],
          now,
          endedAt: '2027-07-02T00:00:00Z',
        });
        expect(entitlement.vestedThrough).toBeNull();
        expect(annualGrants(entitlement)).toEqual([
          expect.objectContaining({ transactionId: term.transactionId, status: 'withdrawn' }),
        ]);
      }
    });

    it('lets the kept term decide when two subscriptions each pay for a year from the same day', () => {
      const again = annual('2027-01-01T00:00:00Z', { subscriptionId: 'sub_2' });
      const againRefunded = adjustment(again, 'refund', '2027-07-02T00:00:00Z');
      for (const payments of [
        [term, again],
        [again, term],
      ]) {
        const entitlement = compute({
          payments,
          adjustments: [againRefunded],
          subscriptions: [running('sub_1'), running('sub_2')],
          now: '2027-07-03T00:00:00Z',
        });
        expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
        expect(entitlement.grants.filter((g) => g.kind === 'annual_term')).toEqual([
          expect.objectContaining({ transactionId: term.transactionId, status: 'confirmed' }),
        ]);
      }
    });

    it('lets the kept term decide over a larger payment for the same year refunded in full', () => {
      const kept = annual('2027-01-01T00:00:00Z', { charged: 35100 });
      const larger = annual('2027-01-01T00:00:00Z', { subscriptionId: 'sub_2' });
      const largerRefunded = adjustment(larger, 'refund', '2027-07-02T00:00:00Z');
      for (const payments of [
        [kept, larger],
        [larger, kept],
      ]) {
        const entitlement = compute({
          payments,
          adjustments: [largerRefunded],
          subscriptions: [running('sub_1'), running('sub_2')],
          now: '2027-07-03T00:00:00Z',
        });
        expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
        expect(entitlement.grants.filter((g) => g.kind === 'annual_term')).toEqual([
          expect.objectContaining({ transactionId: kept.transactionId, status: 'confirmed' }),
        ]);
      }
    });

    it.each(['2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', '2027-12-31T23:59:59Z', '2029-01-01T00:00:00Z'])(
      'kept in full: at %s the grant is confirmed from the payment, vested through the term end',
      (now) => {
        const entitlement = compute({ payments: [term], now });

        expect(entitlement.grants.find((grant) => grant.kind === 'annual_term')).toEqual({
          kind: 'annual_term',
          startedAt: date('2027-01-01T00:00:00Z'),
          vestedThrough: date('2028-01-01T00:00:00Z'),
          status: 'confirmed',
          confirmedAt: date('2027-01-01T00:00:00Z'),
          transactionId: term.transactionId,
          withdrawnReason: null,
        });
        expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
      },
    );

    it('serves a lapsed customer, a day into the term, the releases published up to now and later in the term', () => {
      const entitlement = compute({ payments: [term], now: '2027-01-02T00:00:00Z', endedAt: '2027-01-02T00:00:00Z' });
      const customer = { accessStatus: entitlement.access.status, vestedThrough: entitlement.vestedThrough };

      expect(customer.accessStatus).toBe('lapsed');
      expect(mayUseRelease(customer, date('2026-06-01T00:00:00Z'))).toBe(true);
      expect(mayUseRelease(customer, date('2027-01-01T12:00:00Z'))).toBe(true);
      // Published later in the term: covered once it exists. After the term end: not covered.
      expect(mayUseRelease(customer, date('2027-12-31T23:59:59Z'))).toBe(true);
      expect(mayUseRelease(customer, date('2028-01-01T00:00:01Z'))).toBe(false);
    });

    it.each([
      ['refund', 'refund'],
      ['credit', 'refund'],
      ['chargeback', 'chargeback'],
    ])('withdraws the grant on a full %s, even a day into the term', (action, reason) => {
      const returned = adjustment(term, action, '2027-01-02T00:00:00Z');
      const entitlement = compute({
        payments: [term],
        adjustments: [returned],
        now: '2027-01-02T01:00:00Z',
        endedAt: '2027-01-02T00:00:00Z',
      });

      expect(entitlement.grants).toEqual([
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: reason }),
      ]);
      expect(entitlement.vestedThrough).toBeNull();
      expect(mayUseRelease({ accessStatus: 'lapsed', vestedThrough: null }, date('2026-06-01T00:00:00Z'))).toBe(false);
    });

    it('withdraws the grant on a partial refund of one penny, and counts the time the rest pays for', () => {
      const penny = adjustment(term, 'refund', '2027-02-01T00:00:00Z', { amount: 1 });
      const entitlement = compute({ payments: [term], adjustments: [penny], now: '2027-02-01T01:00:00Z' });

      expect(entitlement.grants).toEqual([
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
      ]);
      expect(entitlement.vestedThrough).toBeNull();
      // 38999 of 39000 kept: paid to 13 minutes before the term end.
      const paidThrough = date('2027-01-01T00:00:00Z').getTime() + Math.floor((38999 / 39000) * 365 * DAY);
      expect(entitlement.run).toMatchObject({
        startedAt: date('2027-01-01T00:00:00Z'),
        paidThrough: new Date(paidThrough),
      });
    });

    it('restores the grant when its chargeback is reversed (a dispute won), however the reversal is recorded', () => {
      const chargeback = adjustment(term, 'chargeback', '2027-02-01T00:00:00Z');
      const reverse = adjustment(term, 'chargeback_reverse', '2027-03-01T00:00:00Z');
      const now = '2027-03-01T01:00:00Z';

      expect(compute({ payments: [term], adjustments: [chargeback], now }).vestedThrough).toBeNull();
      for (const adjustments of [
        [chargeback, reverse],
        [{ ...chargeback, status: 'reversed', reversedAt: date('2027-03-01T00:00:00Z') }],
      ]) {
        const entitlement = compute({ payments: [term], adjustments, now });
        expect(entitlement.grants).toEqual([expect.objectContaining({ kind: 'annual_term', status: 'confirmed' })]);
        expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
      }
    });

    it('vests the second year when its payment is made, and keeps the first if only the second is refunded', () => {
      const second = annual('2028-01-01T00:00:00Z');
      const now = '2028-01-02T00:00:00Z';

      const both = compute({ payments: [term, second], now });
      expect(both.grants.filter((g) => g.kind === 'annual_term' && g.status === 'confirmed')).toHaveLength(2);
      expect(vested(both)).toBe('2029-01-01T00:00:00.000Z');

      const refund = adjustment(second, 'refund', '2028-01-02T00:00:00Z');
      const refunded = compute({ payments: [term, second], adjustments: [refund], now, endedAt: now });
      // The first year stays vested, by its own grant and by its 12 paid months.
      expect(vested(refunded)).toBe('2028-01-01T00:00:00.000Z');
      expect(refunded.grants).toContainEqual(
        expect.objectContaining({ startedAt: date('2028-01-01T00:00:00Z'), status: 'withdrawn' }),
      );
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

      // 6 months, 3 of the term kept (less the minutes the penny rounding of the credit took) and 5 and a half monthly
      // ones served: vested, through the end of the paid time served.
      expect(vested(entitlement)).toBe('2028-03-15T00:00:00.000Z');
      expect(entitlement.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z') });
      expect(entitlement.grants).toContainEqual(
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
      );
    });

    it("the owner's example: a year paid, moved to monthly at six months, vested again six months later", () => {
      // Paid yearly on 1 January 2027; on 1 July 2027 the customer moves to monthly, and Paddle credits the 184
      // unserved days of the 365-day term, rounded to the penny. Monthly billing starts the same day. Each payment is
      // recorded when its period starts.
      const year = annual('2027-01-01T00:00:00Z');
      const credit = adjustment(year, 'credit', '2027-07-01T00:00:00Z', {
        amount: Math.round((39000 * 184) / 365),
        itemTypes: ['proration'],
      });
      const at = (now: string, later = monthly('2027-07-01T00:00:00Z', 6)) =>
        compute({
          payments: [year, ...later].filter((paid) => paid.periodStartsAt <= date(now)),
          adjustments: credit.approvedAt! <= date(now) ? [credit] : [],
          now,
        });

      // Before the move: vested at once through the end of the term.
      expect(vested(at('2027-06-30T00:00:00Z'))).toBe('2028-01-01T00:00:00.000Z');

      // After it: the at-once grant is withdrawn, and the first six months are kept as paid time.
      const moved = at('2027-07-01T00:00:00Z', []);
      expect(moved.grants).toEqual([
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn', withdrawnReason: 'refund' }),
      ]);
      expect(moved.vestedThrough).toBeNull();
      expect(moved.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), monthsPaid: 6 });
      expect(Math.abs(moved.run!.paidThrough.getTime() - date('2027-07-01T00:00:00Z').getTime())).toBeLessThan(HOUR);

      // Not vested for another six months: vested once the sixth monthly payment has been served.
      expect(at('2027-12-31T23:59:59Z').vestedThrough).toBeNull();
      expect(at('2027-12-31T23:59:59Z').run).toMatchObject({ vestsAt: date('2028-01-01T00:00:00Z') });
      expect(vested(at('2028-01-01T00:00:00Z'))).toBe('2028-01-01T00:00:00.000Z');

      // Or vested at once again by a new annual payment instead of the monthly ones.
      const bought = at('2027-07-02T00:00:00Z', [annual('2027-07-01T00:00:00Z')]);
      expect(vested(bought)).toBe('2028-07-01T00:00:00.000Z');
      expect(bought.grants).toContainEqual(
        expect.objectContaining({ kind: 'annual_term', startedAt: date('2027-07-01T00:00:00Z'), status: 'confirmed' }),
      );
    });

    it('adds up the paid time across the month the credit took back, counting only the time kept', () => {
      const switched = annual('2027-01-01T00:00:00Z');
      // Half credited: the kept money pays to 2 July 12:00. Monthly billing starts on 1 August; July is not counted.
      const credit = adjustment(switched, 'credit', '2027-04-01T00:00:00Z', { amount: 19500 });
      const later = monthly('2027-08-01T00:00:00Z', 6);

      const entitlement = compute({
        payments: [switched, ...later],
        adjustments: [credit],
        now: '2027-12-01T00:00:00Z',
      });

      // 182.5 days counted to July, and 182.5 more from 1 August.
      expect(entitlement.run).toMatchObject({
        startedAt: date('2027-01-01T00:00:00Z'),
        vestsAt: date('2028-01-30T12:00:00Z'),
      });
    });

    it('vests an annual term with one penny refunded once the next payment serves the 13 minutes it lacks', () => {
      const term = annual('2027-01-01T00:00:00Z');
      const penny = adjustment(term, 'refund', '2027-06-01T00:00:00Z', { amount: 1 });
      const next = monthly('2028-01-01T00:00:00Z', 1);
      const short = 365 * DAY - Math.floor((38999 / 39000) * 365 * DAY);
      const at = (now: string) => compute({ payments: [term, ...next], adjustments: [penny], now });

      expect(Math.round(short / 60000)).toBe(13);
      expect(at('2028-01-01T00:13:00Z').vestedThrough).toBeNull();
      expect(at('2028-01-01T00:13:00Z').grants).toEqual([
        expect.objectContaining({ kind: 'annual_term', status: 'withdrawn' }),
      ]);
      const vestedAt = new Date(date('2028-01-01T00:00:00Z').getTime() + short);
      expect(confirmedRuns(at('2028-01-01T00:14:00Z'))).toEqual([
        // Vested through the end of the paid time served: now, in the month being served.
        expect.objectContaining({ confirmedAt: vestedAt, vestedThrough: date('2028-01-01T00:14:00Z') }),
      ]);
    });
  });

  describe('a chargeback after vesting, then reversed', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 13);
    const chargeback = adjustment(payments[3], 'chargeback', '2028-01-20T00:00:00Z');

    it('loses April after the chargeback: 12 paid months are reached only at the end of the thirteenth', () => {
      const before = compute({ payments, adjustments: [chargeback], now: '2028-01-30T00:00:00Z' });
      const after = compute({ payments, adjustments: [chargeback], now: '2028-02-01T00:00:00Z' });

      expect(before.vestedThrough).toBeNull();
      expect(after.paymentStatuses[payments[3].transactionId]).toBe('charged_back');
      // 13 months paid, April charged back: the twelfth paid month ends on 1 February 2028.
      expect(after.grants).toEqual([expect.objectContaining({ confirmedAt: date('2028-02-01T00:00:00Z') })]);
      expect(vested(after)).toBe('2028-02-01T00:00:00.000Z');
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

  it('counts a free period as nothing, whatever is charged within it, and a free payment within a paid period as nothing', () => {
    const free = payment('2027-01-01T00:00:00Z', { charged: 0 });
    const within = payment('2027-01-15T00:00:00Z', { periodEndsAt: date('2027-02-01T00:00:00Z'), charged: 500 });
    const later = monthly('2027-02-01T00:00:00Z', 12);
    const at = (payments: Payment[], now: string) => compute({ payments, now });

    expect(at([free, within, ...later], '2027-01-20T00:00:00Z').run).toMatchObject({
      startedAt: date('2027-02-01T00:00:00Z'),
      monthsPaid: 12,
    });
    expect(at([free, within, ...later], '2028-01-15T00:00:00Z').vestedThrough).toBeNull();
    expect(vested(at([free, within, ...later], '2028-02-01T00:00:00Z'))).toBe('2028-02-01T00:00:00.000Z');

    const paid = monthly('2027-01-01T00:00:00Z', 12);
    const zero = payment('2027-03-10T00:00:00Z', { periodEndsAt: date('2027-04-01T00:00:00Z'), charged: 0 });
    expect(at([...paid, zero], '2027-06-15T00:00:00Z').run).toEqual(at(paid, '2027-06-15T00:00:00Z').run);
    expect(vested(at([...paid, zero], '2028-01-01T00:00:00Z'))).toBe('2028-01-01T00:00:00.000Z');
  });

  it('counts a month bought with a 50% discount coupon in full', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 12, { charged: 1950 });

    expect(vested(compute({ payments, now: '2028-01-01T00:00:00Z' }))).toBe('2028-01-01T00:00:00.000Z');
  });
});

describe('paid time adds up across gaps', () => {
  // Releases published during the gaps below.
  const inGap = date('2028-06-01T00:00:00Z');

  it('vests six months, a two-year gap and six more months once the twelfth month is served', () => {
    const payments = [
      ...monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' }),
      ...monthly('2029-07-01T00:00:00Z', 6, { subscriptionId: 'sub_2' }),
    ];
    const subscriptions = [ended('sub_1', '2027-07-01T00:00:00Z'), running('sub_2')];
    const at = (now: string) => compute({ payments, subscriptions, now });

    // 181 days, then 184 from 1 July 2029: 365 days on 1 January 2030.
    expect(at('2029-12-31T23:59:59Z').vestedThrough).toBeNull();
    expect(at('2029-12-31T23:59:59Z').run).toMatchObject({ monthsPaid: 12, vestsAt: date('2030-01-01T00:00:00Z') });
    const vestedNow = at('2030-01-01T00:00:00Z');
    expect(vested(vestedNow)).toBe('2030-01-01T00:00:00.000Z');
    // No lower bound: a release published in the gap is vested too.
    expect(coversRelease(vestedNow.vestedThrough, inGap)).toBe(true);
  });

  it('vests eleven months, a gap and one month at the end of that month', () => {
    const payments = [
      ...monthly('2027-01-01T00:00:00Z', 11, { subscriptionId: 'sub_1' }),
      ...monthly('2028-09-01T00:00:00Z', 1, { subscriptionId: 'sub_2' }),
    ];
    const subscriptions = [ended('sub_1', '2027-12-01T00:00:00Z'), ended('sub_2', '2028-10-01T00:00:00Z')];
    const at = (now: string) => compute({ payments, subscriptions, now });

    // 334 days, then September's 30: one day short of 365, within the month-end allowance, every month kept in full.
    expect(at('2028-09-30T23:59:59Z').vestedThrough).toBeNull();
    expect(vested(at('2028-10-01T00:00:00Z'))).toBe('2028-10-01T00:00:00.000Z');
    expect(vested(at('2029-03-01T00:00:00Z'))).toBe('2028-10-01T00:00:00.000Z');
  });

  it('keeps the date at the end of the last paid month through a gap, and moves it on only while paid time is served', () => {
    const payments = [
      ...monthly('2027-01-01T00:00:00Z', 12, { subscriptionId: 'sub_1' }),
      ...monthly('2029-01-01T00:00:00Z', 3, { subscriptionId: 'sub_2' }),
    ];
    const at = (now: string) =>
      vested(compute({ payments, subscriptions: [ended('sub_1', '2028-01-01T00:00:00Z'), running('sub_2')], now }));

    expect(at('2028-01-01T00:00:00Z')).toBe('2028-01-01T00:00:00.000Z');
    expect(at('2028-11-01T00:00:00Z')).toBe('2028-01-01T00:00:00.000Z');
    expect(at('2029-02-10T00:00:00Z')).toBe('2029-02-10T00:00:00.000Z');
    expect(at('2029-12-01T00:00:00Z')).toBe('2029-04-01T00:00:00.000Z');
  });

  it('takes vesting away when a refund of an early month leaves less than 12 months, and keeps a reversed chargeback', () => {
    const payments = [
      ...monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' }),
      ...monthly('2028-01-01T00:00:00Z', 6, { subscriptionId: 'sub_2' }),
    ];
    const subscriptions = [ended('sub_1', '2027-07-01T00:00:00Z'), ended('sub_2', '2028-07-01T00:00:00Z')];
    const now = '2028-08-01T00:00:00Z';
    const at = (adjustments: PaymentAdjustment[]) => compute({ payments, adjustments, subscriptions, now });

    // 181 + 182 days: two short of 365, so the allowance vests it at the end of June 2028.
    expect(vested(at([]))).toBe('2028-07-01T00:00:00.000Z');
    const refund = adjustment(payments[1], 'refund', '2028-07-20T00:00:00Z');
    expect(at([refund]).vestedThrough).toBeNull();
    expect(at([refund]).grants).toEqual([]);

    const chargeback = adjustment(payments[1], 'chargeback', '2028-07-20T00:00:00Z');
    expect(at([chargeback]).vestedThrough).toBeNull();
    const reversed = { ...chargeback, status: 'reversed', reversedAt: date('2028-07-25T00:00:00Z') };
    expect(vested(at([reversed]))).toBe('2028-07-01T00:00:00.000Z');
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

  it('adds the paid time on return to the time before the gap, and moves the date on as it is served', () => {
    const back = compute({
      payments: [...firstRun, ...comeback(1)],
      subscriptions: [firstEnd, running('sub_2')],
      now: '2028-06-10T00:00:00Z',
    });
    expect(back.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), monthsPaid: 13 });
    expect(vested(back)).toBe('2028-06-10T00:00:00.000Z');

    // Cancelled again after two months: vested through the end of July 2028, so v1.5 and v1.6 from the gap too.
    const gone = compute({
      payments: [...firstRun, ...comeback(2)],
      subscriptions: [firstEnd, ended('sub_2', '2028-08-01T00:00:00Z')],
      now: '2028-09-01T00:00:00Z',
    });
    expect(vested(gone)).toBe('2028-08-01T00:00:00.000Z');
    expect(coversRelease(gone.vestedThrough, v15)).toBe(true);
    expect(coversRelease(gone.vestedThrough, v16)).toBe(true);
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

  it('gives the end of the time paid for, and keeps the paid time, only while it runs on to 12 paid months', () => {
    // Cancelled at once on 10 December, nothing refunded: the paid time reaches 12 months on 1 January.
    const twelve = compute({
      payments: monthly('2027-01-01T00:00:00Z', 12),
      now: '2027-12-15T00:00:00Z',
      endedAt: '2027-12-10T00:00:00Z',
    });
    expect(twelve.access.status).toBe('lapsed');
    expect(iso(twelve.runsTo)).toBe('2028-01-01T00:00:00.000Z');
    expect(twelve.run).toMatchObject({ paidThrough: date('2028-01-01T00:00:00Z'), monthsPaid: 12 });

    // Six months paid, cancelled the same way: the time paid for runs on, but vests nothing.
    const six = compute({
      payments: monthly('2027-07-01T00:00:00Z', 6),
      now: '2027-12-15T00:00:00Z',
      endedAt: '2027-12-10T00:00:00Z',
    });
    expect(six.runsTo).toBeNull();
    expect(six.run).toBeNull();

    // Once served, it is vested and nothing runs on.
    const served = compute({
      payments: monthly('2027-01-01T00:00:00Z', 12),
      now: '2028-01-01T00:00:00Z',
      endedAt: '2027-12-10T00:00:00Z',
    });
    expect(served.runsTo).toBeNull();
    expect(served.run).toBeNull();
    expect(vested(served)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('keeps an annual grant confirmed though the subscription ended mid-term, the money kept', () => {
    const term = annual('2027-01-01T00:00:00Z');

    const during = compute({ payments: [term], now: '2027-09-01T00:00:00Z', endedAt: '2027-05-01T00:00:00Z' });
    expect(during.grants).toEqual([expect.objectContaining({ kind: 'annual_term', status: 'confirmed' })]);
    expect(vested(during)).toBe('2028-01-01T00:00:00.000Z');
    expect(vested(compute({ payments: [term], now: '2028-01-01T00:00:00Z', endedAt: '2027-05-01T00:00:00Z' }))).toBe(
      '2028-01-01T00:00:00.000Z',
    );
  });

  it('counts a period paused part-way in full, and the time after the resumption adds to it, overlap counted once', () => {
    const before = monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' });
    // Paused on 15 June with June kept; resumed on 20 June, when Paddle bills a new period from the resumption.
    const after = monthly('2027-06-20T00:00:00Z', 13, { subscriptionId: 'sub_2' });
    const at = (now: string) =>
      compute({
        payments: [...before, ...after],
        subscriptions: [ended('sub_1', '2027-06-15T00:00:00Z', 'paused'), running('sub_2')],
        now,
      });

    // June in full and the period from 20 June overlap, and count once, by June: that period counts only from 1 July,
    // 19 of its 30 days. 6 + 19/30 + 5 paid months by 20 December; the remaining 11/30 of a month are 11/30 of the 31
    // days from 20 December, 11 days and 8 hours and 48 minutes.
    const vestsAt = date('2027-12-31T08:48:00Z').getTime();
    expect(at('2027-12-31T08:47:00Z').vestedThrough).toBeNull();
    expect(Math.abs(at('2028-01-05T00:00:00Z').run!.vestsAt.getTime() - vestsAt)).toBeLessThan(1000);
    expect(vested(at('2028-01-05T00:00:00Z'))).toBe('2028-01-05T00:00:00.000Z');
  });
});

describe('prices', () => {
  it('counts only payments at one of the offer prices: another price on the Pro product earns nothing', () => {
    const offPrice = monthly('2027-01-01T00:00:00Z', 12, { priceId: 'pri_staff_special' });

    expect(compute({ payments: offPrice, now: '2028-01-01T00:00:00Z' }).vestedThrough).toBeNull();
    expect(
      compute({ payments: [annual('2027-01-01T00:00:00Z', { priceId: 'pri_other' })], now: '2027-06-01T00:00:00Z' })
        .grants,
    ).toEqual([]);
    expect(vested(compute({ payments: monthly('2027-01-01T00:00:00Z', 12), now: '2028-01-01T00:00:00Z' }))).toBe(
      '2028-01-01T00:00:00.000Z',
    );
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

    // The refunded subscription's billing periods add no time: the paid time is the second's, from 10 January.
    expect(confirmedRuns(entitlement)).toEqual([
      expect.objectContaining({
        startedAt: date('2027-01-10T00:00:00Z'),
        confirmedAt: date('2028-01-10T00:00:00Z'),
        vestedThrough: date('2028-01-10T00:00:00Z'),
      }),
    ]);

    // Both kept: the overlapping days count once, each as the larger credit of the two months covering it. Where a
    // short month of one subscription overlaps a long one of the other, that is a little more than a calendar month's
    // share, so 12 paid months are reached two days early, on 29 December 2027 at 20:03.
    const both = (now: string) =>
      compute({ payments: [...first, ...second], subscriptions: [running('sub_1'), running('sub_2')], now });
    expect(both('2027-12-29T20:03:00Z').vestedThrough).toBeNull();
    expect(both('2027-12-29T20:03:00Z').run).toMatchObject({ vestsAt: date('2027-12-29T20:03:25.714Z') });
    expect(confirmedRuns(both('2028-01-01T00:00:00Z'))).toEqual([
      expect.objectContaining({ confirmedAt: date('2027-12-29T20:03:25.714Z') }),
    ]);
  });

  describe('a smaller charge stamped with a period that runs past the one it overlaps', () => {
    const sameAs = (a: Entitlement, b: Entitlement) => {
      expect(a.vestedThrough).toEqual(b.vestedThrough);
      expect(a.run).toEqual(b.run);
      expect(a.grants).toEqual(b.grants);
    };

    it('adds nothing to a refunded year: 500 for 1 July 2027 to 1 July 2028 is no term and no year of paid time', () => {
      const term = annual('2027-01-01T00:00:00Z');
      const topUp = annual('2027-07-01T00:00:00Z', { charged: 500 });
      const refund = adjustment(term, 'refund', '2027-07-02T00:00:00Z');
      for (const now of [
        '2027-07-03T00:00:00Z',
        '2028-02-01T00:00:00Z',
        '2028-08-01T00:00:00Z',
        '2030-01-01T00:00:00Z',
      ]) {
        const entitlement = compute({
          payments: [term, topUp],
          adjustments: [refund],
          now,
          endedAt: '2027-07-02T00:00:00Z',
        });
        expect(entitlement.vestedThrough).toBeNull();
        expect(entitlement.grants).toEqual([
          expect.objectContaining({ transactionId: term.transactionId, status: 'withdrawn' }),
        ]);
      }
      for (const now of ['2027-07-03T00:00:00Z', '2028-03-01T00:00:00Z']) {
        sameAs(compute({ payments: [term, topUp], now }), compute({ payments: [term], now }));
      }
    });

    it('adds nothing to a refunded December: 300 for 15 December to 15 January is no month of its own', () => {
      const year = monthly('2027-01-01T00:00:00Z', 12);
      const topUp = payment('2027-12-15T00:00:00Z', { charged: 300 });
      const refund = adjustment(year[11], 'refund', '2027-12-16T00:00:00Z');
      for (const now of ['2028-01-01T00:00:00Z', '2028-02-01T00:00:00Z']) {
        const entitlement = compute({ payments: [...year, topUp], adjustments: [refund], now });
        expect(entitlement.vestedThrough).toBeNull();
        expect(entitlement.run).toMatchObject({ monthsPaid: 11 });
      }
      for (const now of ['2027-12-20T00:00:00Z', '2028-01-01T00:00:00Z', '2028-02-01T00:00:00Z']) {
        sameAs(compute({ payments: [...year, topUp], now }), compute({ payments: year, now }));
      }
    });
  });

  it('counts a smaller charge stamped from before the month it overlaps within that month', () => {
    // 300 for 25 December 2026 to 5 January 2027, beside a January refunded in full: within January, so it pays for
    // 300 / 4200 of it, not for 11 days of its own.
    const year = monthly('2027-01-01T00:00:00Z', 12);
    const early = payment('2026-12-25T00:00:00Z', { periodEndsAt: date('2027-01-05T00:00:00Z'), charged: 300 });
    const refund = adjustment(year[0], 'refund', '2027-01-03T00:00:00Z');
    const entitlement = compute({ payments: [early, ...year], adjustments: [refund], now: '2027-12-20T00:00:00Z' });

    expect(entitlement.run).toMatchObject({ startedAt: date('2027-01-01T00:00:00Z'), monthsPaid: 11 });
    const kept = Math.floor((300 / 4200) * 31 * DAY);
    expect(
      compute({ payments: [early, ...year.slice(0, 1)], adjustments: [refund], now: '2027-01-20T00:00:00Z' }).run,
    ).toMatchObject({ paidThrough: new Date(date('2027-01-01T00:00:00Z').getTime() + kept) });
  });

  describe('a new purchase at a lower price overlapping a period already paid for', () => {
    const oldYear = annual('2027-01-01T00:00:00Z');
    const newYear = annual('2027-07-01T00:00:00Z', { charged: 30000 });
    const annualGrants = (entitlement: Entitlement) => entitlement.grants.filter((g) => g.kind === 'annual_term');

    it('gives both years their terms and about 18 paid months', () => {
      const entitlement = compute({ payments: [oldYear, newYear], now: '2027-07-02T00:00:00Z' });

      expect(annualGrants(entitlement)).toEqual([
        expect.objectContaining({ transactionId: oldYear.transactionId, status: 'confirmed' }),
        expect.objectContaining({ transactionId: newYear.transactionId, status: 'confirmed' }),
      ]);
      expect(vested(entitlement)).toBe('2028-07-01T00:00:00.000Z');
      expect(entitlement.run).toMatchObject({ monthsPaid: 18, paidThrough: date('2028-07-01T00:00:00Z') });
    });

    it('keeps the new year when the old one is credited for its second half at the switch', () => {
      const credit = adjustment(oldYear, 'credit', '2027-07-01T00:00:00Z', { amount: 19500, itemTypes: ['proration'] });
      const entitlement = compute({ payments: [oldYear, newYear], adjustments: [credit], now: '2027-07-02T00:00:00Z' });

      expect(annualGrants(entitlement)).toEqual([
        expect.objectContaining({ transactionId: oldYear.transactionId, status: 'withdrawn' }),
        expect.objectContaining({ transactionId: newYear.transactionId, status: 'confirmed' }),
      ]);
      expect(vested(entitlement)).toBe('2028-07-01T00:00:00.000Z');
      // Half of the old year (182.5 of its 365 days, to 2 July 12:00) and the new year from 1 July: about 18 months.
      expect(entitlement.run).toMatchObject({ monthsPaid: 18 });
    });

    it('counts a cheaper new monthly purchase overlapping a month', () => {
      const january = payment('2027-01-01T00:00:00Z');
      const cheaper = payment('2027-01-15T00:00:00Z', { charged: 2000 });
      const entitlement = compute({ payments: [january, cheaper], now: '2027-01-20T00:00:00Z' });

      // Both count: to 15 February, January and 14 of the new month's 31 days.
      expect(entitlement.run?.paidThrough).toEqual(date('2027-02-15T00:00:00Z'));
    });
  });

  describe('a duplicate charge for a period already paid for', () => {
    const year = monthly('2027-01-01T00:00:00Z', 12);
    const may = year[4];
    const term = annual('2027-01-01T00:00:00Z');
    const nows = ['2027-05-20T00:00:00Z', '2027-12-31T23:59:59Z', '2028-01-01T00:00:00Z', '2028-03-01T00:00:00Z'];
    const same = (a: Payment[], b: Payment[], adjustments: PaymentAdjustment[]) => {
      for (const now of nows) {
        const withDuplicate = compute({ payments: b, adjustments, now });
        const without = compute({ payments: a, now });
        expect(withDuplicate.vestedThrough).toEqual(without.vestedThrough);
        expect(withDuplicate.run).toEqual(without.run);
        expect(withDuplicate.grants).toEqual(without.grants);
      }
    };

    it('changes nothing when refunded in full, monthly or annual', () => {
      const mayAgain = payment(may.periodStartsAt.toISOString());
      same(year, [...year, mayAgain], [adjustment(mayAgain, 'refund', '2027-05-03T00:00:00Z')]);

      const termAgain = annual('2027-01-01T00:00:00Z');
      same([term], [term, termAgain], [adjustment(termAgain, 'refund', '2027-01-03T00:00:00Z')]);
      // Whichever of the two is listed first, and whichever the refund is of.
      same([term], [termAgain, term], [adjustment(termAgain, 'refund', '2027-01-03T00:00:00Z')]);
    });

    it('changes nothing when kept', () => {
      same(year, [...year, payment(may.periodStartsAt.toISOString())], []);
      const termAgain = annual('2027-01-01T00:00:00Z');
      const kept = compute({ payments: [term, termAgain], now: '2027-06-01T00:00:00Z' });
      expect(kept.vestedThrough).toEqual(compute({ payments: [term], now: '2027-06-01T00:00:00Z' }).vestedThrough);
      expect(kept.run).toEqual(compute({ payments: [term], now: '2027-06-01T00:00:00Z' }).run);
    });
  });

  describe('a kept payment on another subscription for time already paid for', () => {
    const year = monthly('2027-01-01T00:00:00Z', 12, { subscriptionId: 'sub_1' });
    const subscriptions = [running('sub_1'), running('sub_2')];
    const at = (payments: Payment[], now: string) => compute({ payments, subscriptions, now });

    it('never takes vesting away: a year with a month from 15 January kept beside it vests on the same day', () => {
      const extra = payment('2027-01-15T00:00:00Z', { subscriptionId: 'sub_2' });

      expect(vested(at(year, '2028-01-01T00:00:00Z'))).toBe('2028-01-01T00:00:00.000Z');
      expect(at([...year, extra], '2027-12-31T23:59:59Z').vestedThrough).toBeNull();
      expect(vested(at([...year, extra], '2028-01-01T00:00:00Z'))).toBe('2028-01-01T00:00:00.000Z');
    });

    it('counts January and February as two paid months beside a month from 15 January', () => {
      const two = monthly('2027-01-01T00:00:00Z', 2, { subscriptionId: 'sub_1' });
      const extra = payment('2027-01-15T00:00:00Z', { subscriptionId: 'sub_2' });

      // 1 to 15 February is 14 of February's 28 days (half a month) and 14 of the other month's 31: it counts as half.
      expect(at([...two, extra], '2027-03-05T00:00:00Z').run).toMatchObject({ monthsPaid: 2 });
    });

    it('vests a year with a month from 15 November beside it at most half a day early', () => {
      const extra = payment('2027-11-15T00:00:00Z', { subscriptionId: 'sub_2' });

      // 1 to 15 December counts as 14 of the other month's 30 days rather than 14 of December's 31: 14/930 of a month
      // more, which December serves in 11 hours and 12 minutes.
      expect(at([...year, extra], '2027-12-31T12:47:59Z').vestedThrough).toBeNull();
      expect(confirmedRuns(at([...year, extra], '2028-01-01T00:00:00Z'))).toEqual([
        expect.objectContaining({ confirmedAt: date('2027-12-31T12:48:00Z') }),
      ]);
    });
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

  it('returns everything with an adjustment in another currency than its payment', () => {
    const inPounds = adjustment(payments[11], 'refund', '2027-12-02T00:00:00Z', { amount: 100 });
    const inDollars = { ...inPounds, currencyCode: 'USD' };
    const status = (made: PaymentAdjustment) =>
      compute({ payments, adjustments: [made], now }).paymentStatuses[payments[11].transactionId];

    expect(status(inPounds)).toBe('partially_refunded');
    expect(status(inDollars)).toBe('refunded');
    // A reversal in another currency restores nothing.
    const chargeback = adjustment(payments[11], 'chargeback', '2027-12-02T00:00:00Z');
    const reversal = adjustment(payments[11], 'chargeback_reverse', '2027-12-09T00:00:00Z', {
      type: 'partial',
      currencyCode: 'USD',
    });
    expect(
      compute({ payments, adjustments: [chargeback, reversal], now }).paymentStatuses[payments[11].transactionId],
    ).toBe('charged_back');
  });

  it('counts each reversal against its own adjustment: two chargebacks reversed in two ways are both reversed', () => {
    const first = adjustment(payments[4], 'chargeback', '2027-06-01T00:00:00Z', { amount: 1000 });
    const second = adjustment(payments[4], 'chargeback', '2027-06-03T00:00:00Z', { amount: 1000 });
    const firstReversed = { ...first, status: 'reversed', reversedAt: date('2027-06-10T00:00:00Z') };
    const secondReversal = adjustment(payments[4], 'chargeback_reverse', '2027-06-20T00:00:00Z', { amount: 1000 });

    const entitlement = compute({ payments, adjustments: [firstReversed, second, secondReversal], now });
    expect(entitlement.paymentStatuses[payments[4].transactionId]).toBe('paid');
    expect(vested(entitlement)).toBe('2028-01-01T00:00:00.000Z');
  });

  it('keeps a chargeback in force when the only reversal is a second record of another one', () => {
    const first = adjustment(payments[4], 'chargeback', '2027-06-01T00:00:00Z', { amount: 1000 });
    const second = adjustment(payments[4], 'chargeback', '2027-06-03T00:00:00Z', { amount: 1000 });
    const firstReversed = { ...first, status: 'reversed', reversedAt: date('2027-06-10T00:00:00Z') };
    const sameReversal = adjustment(payments[4], 'chargeback_reverse', '2027-06-10T00:00:00Z', { amount: 1000 });

    const entitlement = compute({ payments, adjustments: [firstReversed, second, sameReversal], now });
    expect(entitlement.paymentStatuses[payments[4].transactionId]).toBe('charged_back');
    expect(entitlement.vestedThrough).toBeNull();
    // It could be either: nothing is restored for it, and it is flagged for the operator.
    expect(entitlement.ambiguousReversals).toEqual([sameReversal.adjustmentId]);
  });

  it('reverses the chargeback of the same amount when a reversal could be a second record of another one', () => {
    const first = adjustment(payments[4], 'chargeback', '2027-06-01T00:00:00Z', { amount: 1000 });
    const second = adjustment(payments[4], 'chargeback', '2027-06-03T00:00:00Z', { amount: 2000 });
    const firstReversed = { ...first, status: 'reversed', reversedAt: date('2027-06-10T00:00:00Z') };
    const secondReversal = adjustment(payments[4], 'chargeback_reverse', '2027-06-10T00:30:00Z', { amount: 2000 });

    const entitlement = compute({ payments, adjustments: [firstReversed, second, secondReversal], now });
    expect(entitlement.paymentStatuses[payments[4].transactionId]).toBe('paid');
    expect(entitlement.ambiguousReversals).toEqual([]);
  });

  it('pairs a reversal recorded as approved a little before its chargeback', () => {
    const chargeback = adjustment(payments[4], 'chargeback', '2027-06-01T00:01:00Z');
    const reversal = adjustment(payments[4], 'chargeback_reverse', '2027-06-01T00:00:00Z');
    const longBefore = adjustment(payments[4], 'chargeback_reverse', '2027-05-31T00:00:00Z');

    expect(
      compute({ payments, adjustments: [chargeback, reversal], now }).paymentStatuses[payments[4].transactionId],
    ).toBe('paid');
    expect(
      compute({ payments, adjustments: [chargeback, longBefore], now }).paymentStatuses[payments[4].transactionId],
    ).toBe('charged_back');
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

  it('holds at most 90% of the time for a customer refunded 10% of every payment', () => {
    const two = monthly('2027-01-01T00:00:00Z', 24);
    const tenth = two.map((paid) => adjustment(paid, 'refund', '2027-01-02T00:00:00Z', { amount: 390 }));
    const [paidTime] = confirmedRuns(compute({ payments: two, adjustments: tenth, now: '2030-01-01T00:00:00Z' }));

    // 12 months of the first 90% of each month are served 13 and a third months in, in the first days of February
    // 2028; in the end, vested through the end of the last month's kept 90%.
    expect(paidTime.confirmedAt!.getTime()).toBeGreaterThan(date('2028-02-05T00:00:00Z').getTime());
    expect(paidTime.confirmedAt!.getTime()).toBeLessThan(date('2028-02-15T00:00:00Z').getTime());
    expect(paidTime.vestedThrough).toEqual(
      new Date(date('2028-12-01T00:00:00Z').getTime() + Math.floor(0.9 * 31 * DAY)),
    );
  });

  it('never moves the vested-through date later by refunding the first payment, however much of it, and vests later', () => {
    const fourteen = monthly('2027-01-01T00:00:00Z', 14);
    const now = '2028-03-01T00:00:00Z';
    const half = adjustment(fourteen[0], 'refund', '2027-01-05T00:00:00Z', { amount: 1950 });
    const rest = adjustment(fourteen[0], 'refund', '2027-01-06T00:00:00Z', { amount: 1950 });
    const grant = (adjustments: PaymentAdjustment[]) =>
      confirmedRuns(compute({ payments: fourteen, adjustments, now }))[0];

    const [kept, halfReturned, allReturned] = [grant([]), grant([half]), grant([half, rest])];
    expect(halfReturned.vestedThrough.getTime()).toBeLessThanOrEqual(kept.vestedThrough.getTime());
    expect(allReturned.vestedThrough.getTime()).toBeLessThanOrEqual(halfReturned.vestedThrough.getTime());
    expect(halfReturned.confirmedAt!.getTime()).toBeGreaterThan(kept.confirmedAt!.getTime());
    expect(allReturned.confirmedAt!.getTime()).toBeGreaterThan(halfReturned.confirmedAt!.getTime());
    // With January refunded in full the paid time starts in February.
    expect(allReturned.startedAt).toEqual(date('2027-02-01T00:00:00Z'));
  });

  it('gives no time for billing periods that were refunded', () => {
    // Every other month refunded in full: of 24 months billed, January, March, May, July, September and November are
    // counted, six a year, so the twelfth paid month is November 2028.
    const two = monthly('2027-01-01T00:00:00Z', 24);
    const everyOther = two
      .filter((_, i) => i % 2 === 1)
      .map((paid) => adjustment(paid, 'refund', '2027-01-02T00:00:00Z'));
    const at = (now: string) => vested(compute({ payments: two, adjustments: everyOther, now }));

    expect(at('2028-11-30T23:59:59Z')).toBeNull();
    // Vested through the end of the paid time served: the end of November 2028.
    expect(at('2028-12-01T00:00:00Z')).toBe('2028-12-01T00:00:00.000Z');
    expect(at('2029-06-01T00:00:00Z')).toBe('2028-12-01T00:00:00.000Z');
  });

  it('adds six months before a lapse to the months after it; a term refunded in full in between adds nothing', () => {
    // Six months, then an annual term refunded in full four days in (Paddle's full refund cancels the subscription),
    // then nothing until monthly payments from December.
    const first = monthly('2027-01-01T00:00:00Z', 6, { subscriptionId: 'sub_1' });
    const term = annual('2027-07-01T00:00:00Z', { subscriptionId: 'sub_2' });
    const refund = adjustment(term, 'refund', '2027-07-05T00:00:00Z');
    const later = monthly('2027-12-01T00:00:00Z', 12, { subscriptionId: 'sub_3' });
    const subscriptions = [
      ended('sub_1', '2027-07-01T00:00:00Z'),
      ended('sub_2', '2027-07-05T00:00:00Z'),
      running('sub_3'),
    ];
    const at = (now: string) =>
      compute({ payments: [...first, term, ...later], adjustments: [refund], subscriptions, now });

    // Six paid months to 1 July 2027, and six more from 1 December: 12 at the end of May 2028.
    expect(at('2028-05-31T23:59:59Z').vestedThrough).toBeNull();
    expect(at('2028-05-31T23:59:59Z').run).toMatchObject({
      startedAt: date('2027-01-01T00:00:00Z'),
      vestsAt: date('2028-06-01T00:00:00Z'),
    });
    expect(vested(at('2028-06-15T00:00:00Z'))).toBe('2028-06-15T00:00:00.000Z');
  });

  it('never moves the vested-through date later by a refund that ends a subscription early', () => {
    // March refunded; the first subscription cancelled at once on 10 December with December kept, and a second from
    // 20 December. A refund of December takes away December's time and nothing more.
    const first = monthly('2027-01-01T00:00:00Z', 12, { subscriptionId: 'sub_1' });
    const second = monthly('2027-12-20T00:00:00Z', 24, { subscriptionId: 'sub_2' });
    const march = adjustment(first[2], 'refund', '2027-03-05T00:00:00Z');
    const december = adjustment(first[11], 'refund', '2027-12-10T00:00:00Z');
    const subscriptions = [ended('sub_1', '2027-12-10T00:00:00Z'), running('sub_2')];
    const now = '2029-06-01T00:00:00Z';

    const before = compute({ payments: [...first, ...second], adjustments: [march], subscriptions, now });
    const after = compute({ payments: [...first, ...second], adjustments: [march, december], subscriptions, now });

    expect(after.vestedThrough!.getTime()).toBeLessThanOrEqual(before.vestedThrough!.getTime());
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
  it.each([
    ['none', 0],
    ['30 minutes', 30 * 60 * 1000],
    ['2 hours', 2 * HOUR],
    ['a day', DAY],
  ])('treats a gap of %s between subscriptions the same: the paid time adds up, the gap is not counted', (_, gap) => {
    const second = new Date(date('2027-07-01T00:00:00Z').getTime() + gap).toISOString();
    const payments = monthly('2027-01-01T00:00:00Z', 6).concat(monthly(second, 6));
    const vestsAt = new Date(date('2028-01-01T00:00:00Z').getTime() + gap);

    expect(compute({ payments, now: '2027-12-31T23:00:00Z' }).run).toMatchObject({
      startedAt: date('2027-01-01T00:00:00Z'),
      monthsPaid: 12,
    });
    expect(compute({ payments, now: new Date(vestsAt.getTime() - 1).toISOString() }).vestedThrough).toBeNull();
    expect(compute({ payments, now: vestsAt.toISOString() }).vestedThrough).toEqual(vestsAt);
  });

  it.each([12, 13])(
    'vests at the end of the twelfth monthly period from 31 January, whose periods drift to the 28th (%i paid)',
    (count) => {
      // Paddle may bill 31 January, 28 February, 28 March, … (paddle-assumptions.ts): each period is a paid month.
      let start = date('2027-01-31T09:00:00Z');
      const payments = [];
      for (let i = 0; i < count; i++) {
        const end = i === 0 ? date('2027-02-28T09:00:00Z') : addMonths(start, 1);
        payments.push(payment(start.toISOString(), { periodEndsAt: end }));
        start = end;
      }

      expect(compute({ payments, now: '2028-01-28T08:59:59Z' }).vestedThrough).toBeNull();
      expect(vested(compute({ payments, now: '2028-01-28T09:00:00Z' }))).toBe('2028-01-28T09:00:00.000Z');
      expect(vested(compute({ payments, now: '2028-02-10T09:00:00Z' }))).toBe(
        count === 12 ? '2028-01-28T09:00:00.000Z' : '2028-02-10T09:00:00.000Z',
      );

      // A period of which anything is returned counts less than a month: 12 such periods are short of 12 months.
      const refund = adjustment(payments[11], 'refund', '2028-01-20T00:00:00Z', { amount: 10 });
      const refunded = compute({ payments: payments.slice(0, 12), adjustments: [refund], now: '2028-06-01T00:00:00Z' });
      expect(refunded.vestedThrough).toBeNull();
    },
  );

  it('vests twelve monthly periods spread over four years at the end of the twelfth, though they total 356 days', () => {
    // February, March and April of 2027, 2028, 2029 and 2030: 89, 91, 90 and 89 days a year.
    const years = [2027, 2028, 2029, 2030];
    const payments = years.flatMap((year, i) => monthly(`${year}-02-01T00:00:00Z`, 3, { subscriptionId: `sub_${i}` }));
    const subscriptions = years.map((year, i) => ended(`sub_${i}`, `${year}-05-01T00:00:00Z`));
    const at = (now: string) => compute({ payments, subscriptions, now });

    expect(at('2030-04-30T23:59:59Z').vestedThrough).toBeNull();
    expect(vested(at('2030-05-01T00:00:00Z'))).toBe('2030-05-01T00:00:00.000Z');
    expect(vested(at('2031-01-01T00:00:00Z'))).toBe('2030-05-01T00:00:00.000Z');
    // A February kept in full, 28 days, is a paid month.
    expect(compute({ payments: payments.slice(0, 1), subscriptions, now: '2027-02-15T00:00:00Z' }).grants).toEqual([]);
    expect(
      compute({ payments: payments.slice(0, 1), subscriptions: [running('sub_0')], now: '2027-03-01T00:00:00Z' }).run,
    ).toMatchObject({ monthsPaid: 1 });
  });

  it('counts a 27-day monthly period kept in full as a paid month', () => {
    const short = payment('2027-03-01T00:00:00Z', { periodEndsAt: date('2027-03-28T00:00:00Z') });
    const eleven = monthly('2027-03-28T00:00:00Z', 11);
    const at = (now: string) => compute({ payments: [short, ...eleven], now });

    expect(at('2027-03-28T00:00:00Z').run).toMatchObject({ monthsPaid: 12 });
    expect(at('2028-02-27T23:59:59Z').vestedThrough).toBeNull();
    expect(vested(at('2028-02-28T00:00:00Z'))).toBe('2028-02-28T00:00:00.000Z');
  });

  it('counts a monthly-price charge for fewer than 27 days only for the calendar months it covers', () => {
    // Twelve 50p charges, each for one day, a month apart: twelve days, not twelve paid months.
    const days = Array.from({ length: 12 }, (_, i) =>
      payment(addMonths(date('2027-01-10T00:00:00Z'), i).toISOString(), {
        periodEndsAt: new Date(addMonths(date('2027-01-10T00:00:00Z'), i).getTime() + DAY),
        charged: 50,
      }),
    );
    const oneDays = compute({ payments: days, now: '2030-01-01T00:00:00Z' });
    expect(oneDays.vestedThrough).toBeNull();
    expect(compute({ payments: days, now: '2027-12-20T00:00:00Z' }).run).toMatchObject({ monthsPaid: 0 });

    // 5000 for 15 January to 1 February beside January's 3900: January is still one paid month.
    const year = monthly('2027-01-01T00:00:00Z', 12);
    const straddling = payment('2027-01-15T00:00:00Z', { periodEndsAt: date('2027-02-01T00:00:00Z'), charged: 5000 });
    const at = (now: string) => compute({ payments: [...year, straddling], now });
    expect(compute({ payments: [year[0], straddling], now: '2027-01-20T00:00:00Z' }).run).toMatchObject({
      monthsPaid: 1,
      paidThrough: date('2027-02-01T00:00:00Z'),
    });
    expect(at('2027-12-31T23:59:59Z').vestedThrough).toBeNull();
    expect(vested(at('2028-01-01T00:00:00Z'))).toBe('2028-01-01T00:00:00.000Z');
  });

  it('shows six paid months for an annual payment whose kept money falls a penny short of half', () => {
    const year = annual('2027-01-01T00:00:00Z');
    const refund = adjustment(year, 'refund', '2027-01-03T00:00:00Z', { amount: 39000 - 19339 });
    // 19339 of 39000 kept is 180.99 of the year's 365 days: 5.9998 calendar months, shown as 6.
    expect(compute({ payments: [year], adjustments: [refund], now: '2027-03-01T00:00:00Z' }).run).toMatchObject({
      monthsPaid: 6,
    });
  });

  it('counts an annual period as twelve paid months, and a monthly period half refunded as half of one', () => {
    const year = annual('2027-01-01T00:00:00Z');
    expect(compute({ payments: [year], now: '2027-02-01T00:00:00Z' }).run).toMatchObject({ monthsPaid: 12 });

    const month = payment('2027-01-01T00:00:00Z');
    const half = adjustment(month, 'refund', '2027-01-05T00:00:00Z', { amount: 1950 });
    const eleven = monthly('2027-02-01T00:00:00Z', 11);
    const at = (now: string) => compute({ payments: [month, ...eleven], adjustments: [half], now });
    expect(at('2027-12-31T00:00:00Z').run).toMatchObject({ monthsPaid: 11 });
    // 11 and a half paid months, and nothing more paid: never 12.
    expect(at('2030-01-01T00:00:00Z').vestedThrough).toBeNull();
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

  it('estimates when 12 paid months are reached from now when the paid time ended in the past, as in grace', () => {
    // Eleven months paid to 1 December 2027; the renewal failed on 1 December and the customer is in grace.
    const payments = monthly('2027-01-01T00:00:00Z', 11);
    const subscriptions = [running('sub_1', 'past_due', '2027-12-01T00:00:00Z')];
    const entitlement = compute({ payments, subscriptions, now: '2027-12-20T00:00:00Z' });

    expect(entitlement.access.status).toBe('grace');
    expect(entitlement.vestedThrough).toBeNull();
    expect(entitlement.run).toMatchObject({ monthsPaid: 11, vestsAt: date('2028-01-20T00:00:00Z') });
    // While paid ahead, from the end of the paid time.
    expect(compute({ payments, now: '2027-06-15T00:00:00Z' }).run).toMatchObject({
      vestsAt: date('2028-01-01T00:00:00Z'),
    });
  });

  it('estimates from the end of the paid time, not from the end of a period refunded in full', () => {
    // An annual term bought on 1 January 2027 and refunded in full on 5 January, then monthly from 1 February.
    const term = annual('2027-01-01T00:00:00Z');
    const refund = adjustment(term, 'refund', '2027-01-05T00:00:00Z');
    const month = payment('2027-02-01T00:00:00Z', { subscriptionId: 'sub_2' });
    const entitlement = compute({
      payments: [term, month],
      adjustments: [refund],
      subscriptions: [ended('sub_1', '2027-01-05T00:00:00Z'), running('sub_2')],
      now: '2027-02-15T00:00:00Z',
    });

    // One paid month to 1 March 2027, then 11 more.
    expect(entitlement.run).toMatchObject({ monthsPaid: 1, vestsAt: date('2028-02-01T00:00:00Z') });
  });

  it('shows a returning customer the paid time from before their gap, and a lapsed one none', () => {
    const payments = monthly('2027-01-01T00:00:00Z', 3);
    expect(compute({ payments, now: '2029-05-15T00:00:00Z' }).run).toMatchObject({ monthsPaid: 3 });
    expect(compute({ payments, now: '2029-05-15T00:00:00Z', endedAt: '2027-04-01T00:00:00Z' }).run).toBeNull();
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
      offerPriceIds: OFFER_PRICES,
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

  it('counts a billing period as its months, whatever its length, and a short one at a yearly price in proportion', () => {
    const period = (interval: string, frequency: number, start: string, end: string) =>
      monthsOf({
        billingInterval: interval,
        billingFrequency: frequency,
        periodStartsAt: date(start),
        periodEndsAt: date(end),
      });

    expect(period('month', 1, '2027-02-01T00:00:00Z', '2027-03-01T00:00:00Z')).toBe(1);
    expect(period('month', 1, '2027-01-31T00:00:00Z', '2027-02-28T00:00:00Z')).toBe(1);
    expect(period('month', 1, '2027-03-01T00:00:00Z', '2027-04-01T00:00:00Z')).toBe(1);
    expect(period('month', 3, '2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z')).toBe(3);
    expect(period('year', 1, '2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z')).toBe(12);
    expect(period('year', 1, '2028-01-01T00:00:00Z', '2029-01-01T00:00:00Z')).toBe(12);
    // A monthly period counts as a month even if Paddle's period is shorter than a calendar month.
    expect(period('month', 1, '2027-03-01T00:00:00Z', '2027-03-28T00:00:00Z')).toBe(1);
    expect(period('year', 1, '2027-07-01T00:00:00Z', '2028-01-01T00:00:00Z')).toBe(6);
    expect(period('week', 1, '2027-02-01T00:00:00Z', '2027-02-08T00:00:00Z')).toBe(0);
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
  function history(
    seed: number,
    { reversals = true, overlaps = true }: { reversals?: boolean; overlaps?: boolean } = {},
  ) {
    const next = random(seed);
    const payments: Payment[] = [];
    const made: PaymentAdjustment[] = [];
    let start = date('2027-01-01T00:00:00Z');

    for (let i = 0; i < 30; i++) {
      const roll = next();
      if (roll < 0.1) start = new Date(start.getTime() + (1 + Math.floor(next() * 40)) * DAY);
      else if (roll < 0.15 && overlaps) start = new Date(start.getTime() - Math.floor(next() * 10) * DAY);
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
          const reversedAt = new Date(at.getTime() + DAY);
          // Recorded as a *_reverse adjustment, as the original marked reversed, or both.
          const original = made.length - 1;
          const how = next();
          if (how > 0.4) made[original] = { ...made[original], status: 'reversed', reversedAt };
          if (how < 0.7) made.push(adjustment(paid, `${action}_reverse`, reversedAt.toISOString(), { amount }));
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

  // The paid months served by `at`, payment by payment, independently of the module, for histories without overlaps or
  // reversals: each period's months (1 or 12) times the share of its calendar months that its kept money pays for and
  // that has been served.
  function monthsServed(payments: Payment[], made: PaymentAdjustment[], at: number): number {
    const calendar = (start: Date, end: number) => {
      let whole = 0;
      while (addMonths(start, whole + 1).getTime() <= end) whole++;
      const from = addMonths(start, whole).getTime();
      return whole + Math.max(0, end - from) / (addMonths(start, whole + 1).getTime() - from);
    };
    return payments.reduce((total, paid) => {
      if (paid.charged <= 0) return total;
      const returned = made
        .filter((a) => a.transactionId === paid.transactionId)
        .reduce((sum, a) => sum + (a.amount ?? paid.charged), 0);
      const kept = Math.max(0, (paid.charged - returned) / paid.charged);
      const startsAt = paid.periodStartsAt.getTime();
      const keptEnd = startsAt + Math.floor(kept * (paid.periodEndsAt.getTime() - startsAt));
      return kept > 0 && at > startsAt ? total + calendar(paid.periodStartsAt, Math.min(at, keptEnd)) : total;
    }, 0);
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

  it.each(seeds)('vests paid time if and only if 12 kept paid months have been served (seed %i)', (seed) => {
    const { payments, adjustments: made } = history(seed, { reversals: false, overlaps: false });
    const segments = keptSegments(payments, made);
    const epsilon = 1e-6;

    for (const now of nows) {
      const at = date(now).getTime();
      const entitlement = compute({ payments, adjustments: made, now });
      const served = monthsServed(payments, made, at);
      const [paidTime] = confirmedRuns(entitlement);

      expect(paidTime !== undefined).toBe(served >= 12 - epsilon);
      if (!paidTime) continue;

      // Vested the moment the twelfth paid month was served.
      const confirmedAt = paidTime.confirmedAt!.getTime();
      expect(monthsServed(payments, made, confirmedAt)).toBeGreaterThanOrEqual(12 - epsilon);
      expect(monthsServed(payments, made, confirmedAt - 1000)).toBeLessThan(12);
      // Through the end of the paid time served: none of it later, and never later than now.
      const through = paidTime.vestedThrough.getTime();
      expect(through).toBeLessThanOrEqual(at);
      // (The module rounds each kept share down to the millisecond; this test does not.)
      expect(covered(segments, through, at)).toBeLessThan(1);
      expect(covered(segments, through - HOUR, through)).toBeGreaterThan(0);

      // An annual term is vested at once only while nothing of its payment is returned.
      for (const grant of entitlement.grants.filter((g) => g.kind === 'annual_term' && g.status === 'confirmed')) {
        expect(made.some((a) => a.transactionId === grant.transactionId)).toBe(false);
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

    // With both subscriptions running, and with one of them cancelled at some point.
    const cancelledAt = new Date(date('2027-01-01T00:00:00Z').getTime() + Math.floor(next() * 900) * DAY);
    const [which, other] = next() < 0.5 ? ['sub_1', 'sub_2'] : ['sub_2', 'sub_1'];
    for (const subscriptions of [
      [running('sub_1'), running('sub_2')],
      [ended(which, cancelledAt.toISOString()), running(other)],
    ]) {
      for (const now of nows) {
        const before = compute({ payments, adjustments: made, subscriptions, now });
        const after = compute({ payments, adjustments: [...made, extra], subscriptions, now });

        expect(after.vestedThrough?.getTime() ?? 0).toBeLessThanOrEqual(before.vestedThrough?.getTime() ?? 0);
        const [vestedAfter] = confirmedRuns(after);
        const [vestedBefore] = confirmedRuns(before);
        if (vestedAfter)
          expect(vestedAfter.confirmedAt!.getTime()).toBeGreaterThanOrEqual(vestedBefore.confirmedAt!.getTime());
      }
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
