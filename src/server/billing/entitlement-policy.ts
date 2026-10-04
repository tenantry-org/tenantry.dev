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
 * Vesting follows the money kept (the owner's decision of 4 October 2026, plans-and-investigations/
 * Tenantry-Licensing-And-Feed-Plan.md section 2):
 *
 * - A payment at one of the offer prices counts for the part of its billing period that the money still kept from it pays for. With C charged
 *   before tax and R returned (refunds, credits and chargebacks in effect now; a reversed one no longer returns
 *   anything), it counts for the first (C - R) / C of its period, from the period's start. Nothing if R reaches C, or if
 *   nothing was charged (a trial, a period discounted in full). A discount is not money returned: the share is of what
 *   was charged. A payment kept in full counts for its whole period, even if its subscription was cancelled or paused
 *   before the period ended: that time was paid for.
 * - A qualifying period is continuous counted time: each counted part starts no later than the continuity allowance
 *   after the counted time so far (paddle-assumptions.ts), and overlapping parts count once. It vests when it has
 *   lasted 12 months, through the end of the counted time already served (never later than now), and advances as more
 *   is served. A part that counts in full may end up to MONTH_END_TOLERANCE_MS short of the 12 months; nothing else
 *   may.
 * - An annual payment grants its term at once, conditionally, and is confirmed at the term's end if nothing of it has
 *   been returned; anything returned withdraws the grant, at any time. Its kept share counts as above all the same.
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
    const vestsAt = runVestsAt(run);
    if (!vestsAt || vestsAt.getTime() > now) return [];
    return [
      {
        kind: 'qualifying_run',
        startedAt: run.startedAt,
        vestedThrough: new Date(Math.min(now, run.paidThrough.getTime())),
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
    run: currentRun(runs, isEntitled(access.status), input.now),
    conditionalThrough: latest(grants.filter((g) => g.status === 'conditional').map((g) => g.vestedThrough)),
    vestedThrough: latest(grants.filter((g) => g.status === 'confirmed').map((g) => g.vestedThrough)),
    grants,
    paymentStatuses: Object.fromEntries(
      input.payments.map((payment) => [payment.transactionId, ledger.status(payment)]),
    ),
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
  startedAt: Date;
  paidThrough: Date;
  periods: Period[];
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
        const reversals = adjustments.filter((a) => a.action === `${action}_reverse` && a.status === 'approved');
        const restored = reversalsOf(made, reversals, payment);
        return [action, sum(made.map((a) => Math.max(0, amountOf(a, payment) - (restored.get(a) ?? 0))))];
      }),
    ) as Record<(typeof RETURNING_ACTIONS)[number], number>;
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

  /** The qualifying periods: the counted parts of all the customer's payments, joined while continuous, in order. */
  runs(): Run[] {
    const periods = this.input.payments
      .flatMap((payment) => {
        const period = this.countedPeriod(payment);
        return period ? [period] : [];
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime());

    const runs: Run[] = [];
    for (const period of periods) {
      const run = runs.at(-1);
      if (run && continuesRun(run.paidThrough, period.startsAt)) {
        run.periods.push(period);
        if (period.endsAt > run.paidThrough) run.paidThrough = period.endsAt;
      } else {
        runs.push({ startedAt: period.startsAt, paidThrough: period.endsAt, periods: [period] });
      }
    }
    return runs;
  }

  /** A grant for each annual payment that charged something: conditional, confirmed at the term end, or withdrawn. */
  annualTerms(): Grant[] {
    const now = this.input.now;

    return this.input.payments
      .filter(
        (payment) =>
          this.isOffered(payment) &&
          payment.charged > 0 &&
          isAnnualTerm(payment.billingInterval, payment.billingFrequency),
      )
      .map((payment) => {
        const termEnd = payment.periodEndsAt;
        const returned = this.returned(payment);
        const grant: Grant = {
          kind: 'annual_term',
          startedAt: payment.periodStartsAt,
          vestedThrough: termEnd,
          status: 'conditional',
          confirmedAt: null,
          transactionId: payment.transactionId,
          withdrawnReason: null,
        };

        if (returned.chargeback > 0) return withdraw(grant, 'chargeback');
        if (sum(Object.values(returned)) > 0) return withdraw(grant, 'refund');
        if (termEnd <= now) return { ...grant, status: 'confirmed', confirmedAt: termEnd };
        return grant;
      });
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

/** The qualifying period that continues to now, if the customer has access: its progress towards 12 months. */
function currentRun(runs: Run[], hasAccess: boolean, now: Date): CurrentRun | null {
  if (!hasAccess) return null;

  const run = runs.at(-1);
  // A period whose counted time ended more than a grace period ago is not continued by anything the customer has now.
  if (!run || run.paidThrough.getTime() + GRACE_PERIOD_DAYS * DAY_MS < now.getTime()) return null;

  return {
    startedAt: run.startedAt,
    paidThrough: run.paidThrough,
    monthsPaid: wholeMonths(run.startedAt, run.paidThrough),
    vestsAt: runVestsAt(run) ?? addMonths(run.startedAt, 12),
  };
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
// adjustment, oldest first, is either a second record of such a reversal (approved within REVERSAL_RECORD_WINDOW_MS of
// it: it adds nothing) or reverses one adjustment still in force approved before it, the one of the same amount if
// any, else the oldest, restoring its own amount (everything if Paddle calls it full; nothing if its amount is
// unknown or in another currency) up to what that adjustment returned. A reversal with nothing left to reverse
// restores nothing.
function reversalsOf(
  made: PaymentAdjustment[],
  reversals: PaymentAdjustment[],
  payment: Payment,
): Map<PaymentAdjustment, number> {
  const restored = new Map<PaymentAdjustment, number>();
  const paired = new Set<PaymentAdjustment>();
  const time = (at: Date | null) => at?.getTime() ?? Number.POSITIVE_INFINITY;

  for (const adjustment of made) {
    if (adjustment.status === 'reversed') restored.set(adjustment, amountOf(adjustment, payment));
  }

  for (const reversal of [...reversals].sort((a, b) => time(a.approvedAt) - time(b.approvedAt))) {
    const at = time(reversal.approvedAt);
    const record = made.find(
      (a) =>
        !paired.has(a) &&
        a.status === 'reversed' &&
        a.reversedAt !== null &&
        Math.abs(a.reversedAt.getTime() - at) <= REVERSAL_RECORD_WINDOW_MS,
    );
    if (record) {
      paired.add(record);
      continue;
    }

    let amount = 0;
    if (reversal.type === 'full') amount = payment.charged;
    else if (reversal.amount !== null && reversal.currencyCode === payment.currencyCode) amount = reversal.amount;

    // One with no recorded approval time may be the one reversed.
    const approved = (a: PaymentAdjustment) => a.approvedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const inForce = made
      .filter((a) => !paired.has(a) && a.status === 'approved' && approved(a) <= at)
      .sort((a, b) => approved(a) - approved(b));
    const reversed = inForce.find((a) => amountOf(a, payment) === amount) ?? inForce[0];
    if (!reversed) continue;

    paired.add(reversed);
    restored.set(reversed, Math.min(amountOf(reversed, payment), Math.max(0, amount)));
  }
  return restored;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// When the qualifying period reaches 12 months, or null if it does not: 12 calendar months after its start, or the
// end of the first part that gets within the month-end tolerance of that, if sooner. The tolerance is for Paddle's
// month-end renewal dates (paddle-assumptions.ts), so only a part that counts in full, ending where it was billed to,
// may use it.
function runVestsAt(run: Run): Date | null {
  const twelveMonths = addMonths(run.startedAt, 12).getTime();
  const enough = twelveMonths - MONTH_END_TOLERANCE_MS;

  const ends = run.periods.flatMap((period) => {
    const end = period.endsAt.getTime();
    return end >= (period.full ? enough : twelveMonths) ? [end] : [];
  });
  return ends.length === 0 ? null : new Date(Math.min(twelveMonths, ...ends));
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
