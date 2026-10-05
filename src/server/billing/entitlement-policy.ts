import 'server-only';
import type {
  Access,
  AccessStatus,
  CurrentRun,
  Entitlement,
  Grant,
  Payment,
  PaymentAdjustment,
  PaymentStatus,
  SubscriptionState,
} from '@/server/db/billing-store';
import {
  continuesRun,
  isAnnualTerm,
  MONTH_END_TOLERANCE_MS,
  REVERSAL_RECORD_WINDOW_MS,
} from '@/server/billing/paddle-assumptions';

/**
 * What a customer may access, as pure functions: the one place that answers it, for the webhook and reconcile path
 * (customer-access.ts stores the answer), the dashboard and the feed. From a customer's subscriptions (as Paddle last
 * reported them), their Pro payments and the adjustments made to them, it computes:
 *
 * - Access now (`accessFor`): active while a Pro subscription is active or trialing; grace while the only ones that
 *   entitle are past due, for GRACE_PERIOD_DAYS from their first past-due event; lapsed otherwise. While active or in
 *   grace a customer may use every release.
 * - What they own for good, and how far they are towards owning more (`computeEntitlement`). After a lapse they may use
 *   the releases their vested-through date covers (`mayUseRelease`).
 *
 * Vesting follows the money kept, and paid time adds up (the owner's decisions of 4 October 2026,
 * plans-and-investigations/Tenantry-Licensing-And-Feed-Plan.md section 2):
 *
 * - A payment at one of the offer prices counts for the part of its billing period that the money still kept from it
 *   pays for. With C charged before tax and R returned (refunds, credits and chargebacks in effect now; a reversed one
 *   no longer returns anything), it counts for the first (C - R) / C of its period, from the period's start. Nothing if
 *   R reaches C, or if nothing was charged (a trial, a period discounted in full). A discount is not money returned:
 *   the share is of what was charged. A payment kept in full counts for its whole period, even if its subscription was
 *   cancelled or paused before the period ended: that time was paid for.
 * - A qualifying period is a series of billing periods at the offer prices, each starting no later than the continuity
 *   allowance after the billing periods so far end (paddle-assumptions.ts). Whatever was returned, a billing period
 *   continues the series; one that counts for nothing adds no time. A billing period whose subscription ended before
 *   the period did carries the series only to that end (its counted time still counts in full). It starts at the
 *   start of its first billing period that charged something. Neither depends on money returned.
 * - Its counted time served is how much of its counted parts lies between its start and now, overlapping parts once.
 *   It vests when that reaches 12 months (the length of the 12 calendar months from its start), and is then vested
 *   through its start plus its counted time served: never more time than was paid for and served, and never later
 *   than now. If every billing period in it so far counted in full, it may vest at the end of one up to
 *   MONTH_END_TOLERANCE_MS short of the 12 months.
 * - An annual payment kept in full vests its term when it is paid: its grant is confirmed from the start of its billing
 *   period, through the term's end, so the releases published up to then are vested as they are published, even if the
 *   subscription is cancelled or paused before the term ends. Any refund, credit or chargeback of it withdraws the
 *   grant, at any time, and a reversal that leaves nothing returned restores it. Its kept share counts as above all
 *   the same.
 * - Everything is judged as the ledger stands now. Money returned after a vesting takes away whatever relied on it, and
 *   a reversal restores it. Cancelling or lapsing takes nothing away.
 *
 * Everything is computed from the ledger each time (customer-access.ts: syncCustomer stores the result), so replaying
 * or reordering Paddle's events cannot change the outcome, and the outcome changes with time alone only as counted time
 * is served.
 */

export interface EntitlementInput {
  subscriptions: SubscriptionState[];
  payments: Payment[];
  adjustments: PaymentAdjustment[];
  /** The product that is Tenantry Pro (PADDLE_PRO_PRODUCT_ID): a subscription to any other entitles to nothing. */
  proProductId: string;
  /**
   * The prices Tenantry Pro is offered at (PADDLE_PRICE_MONTHLY and PADDLE_PRICE_YEARLY). A payment at any other price,
   * even one on the Pro product, counts for nothing and grants nothing: another price could have any amount or period.
   */
  offerPriceIds: string[];
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a past-due subscription keeps access. Paddle's default payment recovery retries a failed renewal and cancels
 * the subscription after 30 days if it is not recovered; this cutoff ends access at the same point even if that
 * cancellation never arrives (or recovery is configured to run longer).
 */
export const GRACE_PERIOD_DAYS = 30;

export function graceEndsAt(graceStartedAt: Date): Date {
  return new Date(graceStartedAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
}

export function isEntitled(status: AccessStatus): boolean {
  return status === 'active' || status === 'grace';
}

/**
 * When the customer's grace ends: the latest end of the grace periods of their past-due Pro subscriptions, whether or
 * not it has passed, or null if none is past due. A past-due subscription with no recorded grace start (none is
 * recorded after the first past-due event, but rows migrated from the old schema may lack one) is treated as having
 * no grace left, never as starting now, so a missing date cannot extend access.
 */
export function graceEndFor(subscriptions: GraceSubscription[], proProductId: string): Date | null {
  return latest(
    subscriptions
      .filter((subscription) => subscription.productId === proProductId && subscription.status === 'past_due')
      .flatMap((subscription) => (subscription.graceStartedAt ? [graceEndsAt(subscription.graceStartedAt)] : [])),
  );
}

/** What deciding grace reads from a subscription. */
export type GraceSubscription = Pick<SubscriptionState, 'productId' | 'status' | 'graceStartedAt'>;

/**
 * The customer's access now, from their subscriptions: active if any Pro subscription is active or trialing, grace if
 * any is past due and its grace period has not ended by `now` (graceEndFor), otherwise lapsed. Paused and cancelled
 * subscriptions, and subscriptions to other products, entitle to nothing.
 */
export function accessFor(subscriptions: SubscriptionState[], proProductId: string, now: Date): Access {
  const pro = subscriptions.filter((subscription) => subscription.productId === proProductId);

  if (pro.some((subscription) => subscription.status === 'active' || subscription.status === 'trialing')) {
    return { status: 'active', graceEndsAt: null };
  }

  const graceEnd = graceEndFor(pro, proProductId);
  return graceEnd && graceEnd > now
    ? { status: 'grace', graceEndsAt: graceEnd }
    : { status: 'lapsed', graceEndsAt: null };
}

/**
 * The customer's access now, from what is stored (active_subscriptions: its status and, in grace, when grace ends). A
 * grace period that has ended counts as lapsed from that moment, before the daily reconcile records it, so the feed and
 * the dashboard stop treating the customer as entitled at the same instant. Never recorded counts as lapsed.
 */
export function currentAccess(stored: Access | null, now: Date): Access {
  if (!stored) return { status: 'lapsed', graceEndsAt: null };
  if (stored.status !== 'grace') return { status: stored.status, graceEndsAt: null };
  return stored.graceEndsAt && stored.graceEndsAt > now ? stored : { status: 'lapsed', graceEndsAt: null };
}

/**
 * Whether the package feed serves the customer anything: every release while they have access, the vested releases
 * after a lapse, and nothing to a lapsed customer with nothing vested. Feed tokens are created only for a customer it
 * serves (the Pro access page says why not otherwise).
 */
export function canRestore(customer: { accessStatus: AccessStatus; vestedThrough: Date | null }): boolean {
  return isEntitled(customer.accessStatus) || customer.vestedThrough !== null;
}

/**
 * Whether the customer may use (and the feed may serve them) a release with this entitlement date
 * (pro_releases.entitlement_at): every release while they have access, and after a lapse those their vested-through
 * date covers.
 */
export function mayUseRelease(
  customer: { accessStatus: AccessStatus; vestedThrough: Date | null },
  entitlementAt: Date,
): boolean {
  return isEntitled(customer.accessStatus) || coversRelease(customer.vestedThrough, entitlementAt);
}

export function computeEntitlement(input: EntitlementInput): Entitlement {
  const access = accessFor(input.subscriptions, input.proProductId, input.now);
  const ledger = new Ledger(input);
  const now = input.now.getTime();
  const runs = ledger.runs();

  const runGrants = runs.flatMap((run): Grant[] => {
    const vestsAt = ledger.vestsAt(run);
    if (!vestsAt || vestsAt.getTime() > now) return [];
    return [
      {
        kind: 'qualifying_run',
        startedAt: run.startedAt,
        vestedThrough: new Date(run.startedAt.getTime() + countedTime(run, now)),
        status: 'confirmed',
        confirmedAt: vestsAt,
        transactionId: null,
        withdrawnReason: null,
      },
    ];
  });
  const grants = dedupe([...runGrants, ...ledger.annualTerms()]);

  return {
    access,
    run: currentRun(runs, ledger, isEntitled(access.status), input.now),
    vestedThrough: latest(grants.filter((g) => g.status === 'confirmed').map((g) => g.vestedThrough)),
    grants,
    paymentStatuses: Object.fromEntries(
      input.payments.map((payment) => [payment.transactionId, ledger.status(payment)]),
    ),
    ambiguousReversals: input.payments.flatMap((payment) => ledger.ambiguousReversals(payment)).sort(),
  };
}

/** Whether a vested-through date covers a release with this entitlement date (pro_releases.entitlement_at). */
export function coversRelease(vestedThrough: Date | null, entitlementAt: Date): boolean {
  return vestedThrough !== null && entitlementAt.getTime() <= vestedThrough.getTime();
}

/** The date `months` calendar months after `date` (UTC), on the month's last day if it is shorter. */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Whole months from `start` to `end`, counting a month that ends within the month-end tolerance of `end`. */
export function wholeMonths(start: Date, end: Date): number {
  let months = 0;
  while (addMonths(start, months + 1).getTime() <= end.getTime() + MONTH_END_TOLERANCE_MS) months++;
  return months;
}

// ---------------------------------------------------------------------------------------------------------------------

/** The counted part of a payment's period. */
interface Period {
  payment: Payment;
  startsAt: Date;
  endsAt: Date;
  /** Whether nothing of the payment has been returned, so it counts for its whole period. */
  full: boolean;
}

interface Run {
  /** The start of its first billing period that charged something. */
  startedAt: Date;
  /** The end of its billing periods. */
  billedThrough: Date;
  /** Its billing periods. */
  payments: Payment[];
  /** Its counted time: the counted parts of its billing periods, merged where they meet or overlap, in order. */
  counted: [number, number][];
}

/** The adjustments that return money, and the reversals that restore it. */
const RETURNING_ACTIONS = ['refund', 'credit', 'chargeback'] as const;

class Ledger {
  private readonly adjustments = new Map<string, PaymentAdjustment[]>();

  constructor(private readonly input: EntitlementInput) {
    for (const adjustment of input.adjustments) {
      const list = this.adjustments.get(adjustment.transactionId) ?? [];
      list.push(adjustment);
      this.adjustments.set(adjustment.transactionId, list);
    }
  }

  /**
   * How much of the payment has been returned now, by action, before tax. Each approved refund, credit or chargeback
   * returns its amount until it is reversed: by Paddle marking it reversed, or by an approved `<action>_reverse`
   * adjustment, which is counted against one adjustment of its own action (`reversalsOf`). A reversal never restores
   * more than the adjustment it reverses returned, so it cannot offset another kind of adjustment or another payment.
   */
  returned(payment: Payment): Record<(typeof RETURNING_ACTIONS)[number], number> {
    const adjustments = this.adjustments.get(payment.transactionId) ?? [];

    return Object.fromEntries(
      RETURNING_ACTIONS.map((action) => {
        const made = adjustments.filter(
          (a) => a.action === action && (a.status === 'approved' || a.status === 'reversed'),
        );
        const { restored } = this.reversals(payment, action);
        return [action, sum(made.map((a) => Math.max(0, amountOf(a, payment) - (restored.get(a) ?? 0))))];
      }),
    ) as Record<(typeof RETURNING_ACTIONS)[number], number>;
  }

  /** The payment's reversals that could be either of two things (`reversalsOf`), by adjustment id. */
  ambiguousReversals(payment: Payment): string[] {
    return RETURNING_ACTIONS.flatMap((action) => this.reversals(payment, action).ambiguous);
  }

  private reversals(payment: Payment, action: (typeof RETURNING_ACTIONS)[number]) {
    const adjustments = this.adjustments.get(payment.transactionId) ?? [];
    const made = adjustments.filter((a) => a.action === action && (a.status === 'approved' || a.status === 'reversed'));
    const reversals = adjustments.filter((a) => a.action === `${action}_reverse` && a.status === 'approved');
    return reversalsOf(made, reversals, payment);
  }

  /** The share of its period the money kept from the payment pays for, from 0 to 1. */
  keptShare(payment: Payment): number {
    if (payment.charged <= 0) return 0;
    const returned = sum(Object.values(this.returned(payment)));
    return Math.min(1, Math.max(0, (payment.charged - returned) / payment.charged));
  }

  status(payment: Payment): PaymentStatus {
    const returned = this.returned(payment);
    if (returned.chargeback > 0) return 'charged_back';
    const total = sum(Object.values(returned));
    if (total <= 0) return 'paid';
    return total >= payment.charged ? 'refunded' : 'partially_refunded';
  }

  /**
   * The qualifying periods, in order: the billing periods at the offer prices, joined while each follows on from the
   * ones before, with the counted parts of their payments. A series in which nothing was charged is none.
   */
  runs(): Run[] {
    const billed = this.input.payments
      .filter((payment) => this.isOffered(payment) && payment.periodEndsAt > payment.periodStartsAt)
      .sort(
        (a, b) =>
          a.periodStartsAt.getTime() - b.periodStartsAt.getTime() ||
          a.periodEndsAt.getTime() - b.periodEndsAt.getTime(),
      );

    const series: { billedThrough: Date; payments: Payment[] }[] = [];
    for (const payment of billed) {
      const last = series.at(-1);
      const through = this.billedThrough(payment);
      if (last && continuesRun(last.billedThrough, payment.periodStartsAt)) {
        last.payments.push(payment);
        if (through > last.billedThrough) last.billedThrough = through;
      } else {
        series.push({ billedThrough: through, payments: [payment] });
      }
    }

    return series.flatMap(({ billedThrough, payments }): Run[] => {
      const charged = payments.find((payment) => payment.charged > 0);
      if (!charged) return [];
      const parts = payments.flatMap((payment) => {
        const period = this.countedPeriod(payment);
        return period ? [[period.startsAt.getTime(), period.endsAt.getTime()] as [number, number]] : [];
      });
      return [{ startedAt: charged.periodStartsAt, billedThrough, payments, counted: merge(parts) }];
    });
  }

  /**
   * When the qualifying period vests, or null if its counted time does not reach 12 months: when its counted time
   * served reaches the length of the 12 calendar months from its start, or the end of a counted part within the
   * month-end tolerance of that, if every billing period in it to there counted in full and so is sooner.
   */
  vestsAt(run: Run): Date | null {
    const start = run.startedAt.getTime();
    const required = addMonths(run.startedAt, 12).getTime() - start;
    const vestings: number[] = [];

    let served = 0;
    for (const [from, to] of run.counted) {
      if (served + (to - from) >= required) {
        vestings.push(from + (required - served));
        break;
      }
      served += to - from;
      const allFull = run.payments
        .filter((payment) => payment.periodStartsAt.getTime() >= start && payment.periodStartsAt.getTime() < to)
        .every((payment) => this.keptShare(payment) >= 1);
      if (served >= required - MONTH_END_TOLERANCE_MS && allFull) vestings.push(to);
    }
    return vestings.length === 0 ? null : new Date(Math.min(...vestings));
  }

  /**
   * A grant for each annual payment that charged something: confirmed when paid (from its billing period's start)
   * through the term's end while nothing of it is returned, and withdrawn otherwise.
   */
  annualTerms(): Grant[] {
    return this.input.payments
      .filter(
        (payment) =>
          this.isOffered(payment) &&
          payment.charged > 0 &&
          isAnnualTerm(payment.billingInterval, payment.billingFrequency),
      )
      .map((payment) => {
        const returned = this.returned(payment);
        const grant: Grant = {
          kind: 'annual_term',
          startedAt: payment.periodStartsAt,
          vestedThrough: payment.periodEndsAt,
          status: 'confirmed',
          confirmedAt: payment.periodStartsAt,
          transactionId: payment.transactionId,
          withdrawnReason: null,
        };

        if (returned.chargeback > 0) return withdraw(grant, 'chargeback');
        if (sum(Object.values(returned)) > 0) return withdraw(grant, 'refund');
        return grant;
      });
  }

  /**
   * How far a billing period carries a qualifying period: to its end, or to when its subscription ended, if sooner. A
   * period refunded in full (which cancels its subscription at once, apply-paddle-event.ts) therefore cannot keep a
   * qualifying period going after it. It never depends on money returned, so returning money can never split a
   * qualifying period and start a later one afresh.
   */
  private billedThrough(payment: Payment): Date {
    const endedAt = this.input.subscriptions.find((sub) => sub.subscriptionId === payment.subscriptionId)?.endedAt;
    if (!endedAt || endedAt >= payment.periodEndsAt) return payment.periodEndsAt;
    return new Date(Math.max(endedAt.getTime(), payment.periodStartsAt.getTime()));
  }

  /** Whether the payment was at one of the prices Pro is offered at. */
  isOffered(payment: Payment): boolean {
    return this.input.offerPriceIds.includes(payment.priceId);
  }

  // The first kept share of the payment's period, or null if nothing of it is kept or it was not at an offer price.
  private countedPeriod(payment: Payment): Period | null {
    if (!this.isOffered(payment)) return null;
    const share = this.keptShare(payment);
    if (share <= 0) return null;

    const startsAt = payment.periodStartsAt.getTime();
    const length = payment.periodEndsAt.getTime() - startsAt;
    if (length <= 0) return null;
    const full = share >= 1;
    const endsAt = full ? payment.periodEndsAt : new Date(startsAt + Math.floor(share * length));
    return { payment, startsAt: payment.periodStartsAt, endsAt, full };
  }
}

/**
 * The qualifying period that continues to now, if the customer has access and it has counted time: its progress
 * towards 12 months. It is paid
 * through its start plus all its counted time, and vests when its counted time reaches 12 months, or, if it has not
 * been paid that far, as it would if every billing period from the end of its billing so far counted in full.
 */
function currentRun(runs: Run[], ledger: Ledger, hasAccess: boolean, now: Date): CurrentRun | null {
  if (!hasAccess) return null;

  const run = runs.at(-1);
  // A series whose billing ended more than a grace period ago is not continued by anything the customer has now.
  if (!run || run.billedThrough.getTime() + GRACE_PERIOD_DAYS * DAY_MS < now.getTime()) return null;

  const counted = countedTime(run, Number.POSITIVE_INFINITY);
  if (counted <= 0) return null;
  const paidThrough = new Date(run.startedAt.getTime() + counted);
  const required = addMonths(run.startedAt, 12).getTime() - run.startedAt.getTime();
  return {
    startedAt: run.startedAt,
    paidThrough,
    monthsPaid: wholeMonths(run.startedAt, paidThrough),
    vestsAt: ledger.vestsAt(run) ?? new Date(run.billedThrough.getTime() + Math.max(0, required - counted)),
  };
}

// The qualifying period's counted time served by `until`: how much of its counted parts lies before it.
function countedTime(run: Run, until: number): number {
  return sum(run.counted.map(([from, to]) => Math.max(0, Math.min(to, until) - from)));
}

// The intervals merged where they meet or overlap, in order.
function merge(intervals: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

// How much an adjustment returns: everything charged if Paddle calls it full (its amount, computed on another total,
// can differ by a penny) or if it is in another currency than the payment; otherwise its recorded amount; if that is
// unknown, nothing for a tax-only correction and everything charged otherwise, so a missing amount never counts as
// money kept.
function amountOf(adjustment: PaymentAdjustment, payment: Payment): number {
  if (adjustment.type === 'full') return payment.charged;
  if (adjustment.amount !== null) {
    return adjustment.currencyCode === payment.currencyCode ? Math.max(0, adjustment.amount) : payment.charged;
  }
  const taxOnly = adjustment.itemTypes.length > 0 && adjustment.itemTypes.every((type) => type === 'tax');
  return taxOnly ? 0 : payment.charged;
}

// How much of each adjustment in `made` has been reversed. One marked reversed is reversed in full. Each `*_reverse`
// adjustment, oldest first, restores its own amount (everything if Paddle calls it full; nothing if its amount is
// unknown or in another currency), up to what the adjustment it reverses returned. Paddle does not say which one that
// is, so it is either a second record of a reversal already marked (one marked within REVERSAL_RECORD_WINDOW_MS of it,
// which adds nothing) or the reversal of one still in force approved before it, or within the window after it (clocks
// differ). When both are possible, the one of its amount is taken; if that does not decide, it is taken as a second
// record, restoring nothing, and returned in `ambiguous` for the operator. Otherwise the adjustment of its amount is
// taken, else the oldest. Ties are broken by adjustment id, so the order the ledger lists them in never matters.
function reversalsOf(
  made: PaymentAdjustment[],
  reversals: PaymentAdjustment[],
  payment: Payment,
): { restored: Map<PaymentAdjustment, number>; ambiguous: string[] } {
  const restored = new Map<PaymentAdjustment, number>();
  const paired = new Set<PaymentAdjustment>();
  const ambiguous: string[] = [];
  const time = (at: Date | null, missing: number) => at?.getTime() ?? missing;
  const byTime = (at: (a: PaymentAdjustment) => number) => (a: PaymentAdjustment, b: PaymentAdjustment) =>
    at(a) - at(b) || a.adjustmentId.localeCompare(b.adjustmentId);
  // One with no recorded approval time may be the one reversed.
  const approved = (a: PaymentAdjustment) => time(a.approvedAt, Number.NEGATIVE_INFINITY);

  for (const adjustment of made) {
    if (adjustment.status === 'reversed') restored.set(adjustment, amountOf(adjustment, payment));
  }

  for (const reversal of [...reversals].sort(byTime((a) => time(a.approvedAt, Number.POSITIVE_INFINITY)))) {
    const at = time(reversal.approvedAt, Number.POSITIVE_INFINITY);
    let amount = 0;
    if (reversal.type === 'full') amount = payment.charged;
    else if (reversal.amount !== null && reversal.currencyCode === payment.currencyCode) amount = reversal.amount;
    const ofAmount = (a: PaymentAdjustment) => amountOf(a, payment) === amount;

    const records = made
      .filter(
        (a) =>
          !paired.has(a) &&
          a.status === 'reversed' &&
          a.reversedAt !== null &&
          Math.abs(a.reversedAt.getTime() - at) <= REVERSAL_RECORD_WINDOW_MS,
      )
      .sort(byTime((a) => a.reversedAt!.getTime()));
    const inForce = made
      .filter((a) => !paired.has(a) && a.status === 'approved' && approved(a) <= at + REVERSAL_RECORD_WINDOW_MS)
      .sort(byTime(approved));

    if (records.length > 0) {
      const inForceOfAmount = inForce.filter(ofAmount);
      if (inForceOfAmount.length === 0 || records.some(ofAmount)) {
        if (inForce.length > 0) ambiguous.push(reversal.adjustmentId);
        paired.add(records.find(ofAmount) ?? records[0]);
        continue;
      }
      inForce.splice(0, inForce.length, ...inForceOfAmount);
    }

    const reversed = inForce.find(ofAmount) ?? inForce[0];
    if (!reversed) continue;
    paired.add(reversed);
    restored.set(reversed, Math.min(amountOf(reversed, payment), Math.max(0, amount)));
  }
  return { restored, ambiguous };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function withdraw(grant: Grant, reason: 'refund' | 'chargeback'): Grant {
  return { ...grant, status: 'withdrawn', confirmedAt: null, withdrawnReason: reason };
}

function latest(dates: Date[]): Date | null {
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime())));
}

// One grant per kind and start, as vested_entitlements keys them: of two annual payments for the same term start, the
// later-ending wins, and a withdrawn one over a kept one on a tie.
function dedupe(grants: Grant[]): Grant[] {
  const byKey = new Map<string, Grant>();

  for (const grant of grants) {
    const key = `${grant.kind}:${grant.startedAt.getTime()}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      grant.vestedThrough > existing.vestedThrough ||
      (grant.vestedThrough.getTime() === existing.vestedThrough.getTime() && grant.status === 'withdrawn')
    ) {
      byKey.set(key, grant);
    }
  }

  return [...byKey.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
