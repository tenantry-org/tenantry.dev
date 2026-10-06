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
import { isAnnualTerm, REVERSAL_RECORD_WINDOW_MS } from '@/server/billing/paddle-assumptions';

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
 * Vesting follows the money kept, and paid time adds up (the owner's decisions of 4 and 5 October 2026,
 * plans-and-investigations/Tenantry-Licensing-And-Feed-Plan.md section 2):
 *
 * - A billing period is a payment at one of the offer prices together with the payments of the same subscription,
 *   billed at the same interval, whose periods lie within its period, such as a prorated charge (`billingPeriods`):
 *   proration pays for time already paid for, so it adds no time. A payment at another interval within it, such as a
 *   monthly one after a move from an annual term, is a billing period of its own. A billing period counts for the part
 *   of its period that the money still kept from its payments pays for. With C charged before tax across them and R
 *   returned (refunds, credits and chargebacks in effect now; a reversed one no longer returns anything), it counts for
 *   the first (C - R) / C of its period, from the period's start. Nothing if R reaches C, or if nothing was charged (a
 *   trial, a period discounted in full). A discount is not money returned: the share is of what was charged. A billing
 *   period kept in full counts for its whole period, even if its subscription was cancelled or paused before the
 *   period ended: that time was paid for.
 * - A billing period pays for months: a monthly one for one month and an annual one for twelve, whatever the length of
 *   the period, as a calendar month runs from 28 to 31 days (`monthsOf`). Its counted part counts for the calendar
 *   months it covers from the period's start, up to the period's months: a monthly period kept in full is one paid
 *   month, half of it kept is half a month, and an annual period kept for its first 181 days, from 1 January, is six.
 * - The customer's paid time is the counted parts of all their billing periods. It adds up across gaps: separate
 *   subscriptions, with or without time between them, all count. Where counted parts overlap, the time counts once, as
 *   the largest credit any of them gives it, so a kept payment never lowers the count. It starts at the start of its first counted part.
 * - It vests when the paid time served (the counted parts before now) reaches 12 paid months by that count. From then
 *   on it is vested through the end of the paid time served: the latest moment before now that paid time covers. In a
 *   gap that stays where the last paid period ended; a later paid period moves it on as it is served. It is never
 *   later than now.
 * - An annual payment kept in full vests its term when it is paid: its grant is confirmed from the start of its billing
 *   period, through the term's end, so the releases published up to then are vested as they are published, even if the
 *   subscription is cancelled or paused before the term ends. Any refund, credit or chargeback of it withdraws the
 *   grant, at any time, and a reversal that leaves nothing returned restores it. Its kept share counts as paid time all
 *   the same.
 * - Everything is judged as the ledger stands now. Money returned after a vesting takes away whatever relied on it,
 *   and a reversal restores it. Cancelling or lapsing takes nothing away.
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
  const paid = ledger.paidTime();
  const vestsAt = paid && ledger.vestsAt(paid);

  const paidGrants: Grant[] =
    paid && vestsAt && vestsAt.getTime() <= now
      ? [
          {
            kind: 'paid_time',
            startedAt: paid.startedAt,
            vestedThrough: new Date(servedThrough(paid, now)),
            status: 'confirmed',
            confirmedAt: vestsAt,
            transactionId: null,
            withdrawnReason: null,
          },
        ]
      : [];
  const grants = [...paidGrants, ...ledger.annualTerms()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  return {
    access,
    run: isEntitled(access.status) && paid ? progress(paid, vestsAt, input.now) : null,
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

// ---------------------------------------------------------------------------------------------------------------------

/** A billing period: its payment, and the payments of its subscription and interval whose periods lie within it. */
interface BillingPeriod {
  payment: Payment;
  within: Payment[];
}

/** The customer's paid time. */
interface PaidTime {
  /** The start of its first counted part. */
  startedAt: Date;
  /** The end of the latest billing period at an offer price. */
  billedThrough: Date;
  /**
   * The counted parts of the billing periods, cut where they meet or overlap so that each stretch of time is counted by
   * one of them, in order.
   */
  counted: Stretch[];
}

/** A stretch of paid time, and the counted part that counts it. */
interface Stretch {
  from: number;
  to: number;
  part: CountedPart;
}

/**
 * The counted part of a billing period: from its start to the end of the time the money kept pays for. It counts for
 * the calendar months it covers from `periodStart`, times `scale`, which is less than 1 only for a period longer than
 * its months (a monthly period of 31 days that starts on the 28th, for one month).
 */
interface CountedPart {
  periodStart: Date;
  from: number;
  to: number;
  scale: number;
}

/** Paid months closer than this to 12 are 12: a sum of shares of periods can fall short by a rounding error. */
const MONTHS_EPSILON = 1e-6;

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

  /**
   * The share of a billing period the money kept from its payments pays for, from 0 to 1: what is kept of all they
   * charged. Nothing if its own payment charged nothing (a trial, a period discounted in full): a period nobody paid for
   * is no paid time, whatever is charged within it.
   */
  keptShare(period: BillingPeriod): number {
    if (period.payment.charged <= 0) return 0;
    const payments = [period.payment, ...period.within];
    const charged = sum(payments.map((payment) => Math.max(0, payment.charged)));
    if (charged <= 0) return 0;
    return Math.min(1, sum(payments.map((payment) => this.kept(payment))) / charged);
  }

  /** What is kept of what the payment charged: nothing below zero. */
  kept(payment: Payment): number {
    return Math.max(0, payment.charged - sum(Object.values(this.returned(payment))));
  }

  /**
   * The billing periods of the payments at the offer prices. Of the payments of one subscription billed at one
   * interval, a payment for a whole period of that interval (its calendar months: one a month, twelve a year) holds a
   * billing period unless its period overlaps one already held, and so does any other payment that overlaps none. A
   * payment whose period overlaps one held, and that charged less than the payment holding it (or anything, if that
   * charged nothing), is within it: a prorated charge, even one stamped with a period that runs past it. One that charged at least as much is a billing
   * period of its own: a duplicate charge, or a new purchase, such as a new year after a move to monthly. So money
   * returned from a duplicate takes nothing from the original; their kept time counts once (`onceEach`), and of two
   * annual terms for one period the kept one decides (`annualTerms`). Whole periods are taken first, then the
   * earliest-starting, then the one that charged more, then the one with more kept (then the lower transaction id), so
   * the grouping does not depend on the order of the ledger.
   */
  billingPeriods(): BillingPeriod[] {
    const whole = (payment: Payment) =>
      calendarMonths(payment.periodStartsAt, payment.periodEndsAt.getTime()) >= nominalMonths(payment) ? 1 : 0;
    const payments = this.input.payments
      .filter((payment) => this.isOffered(payment) && payment.periodEndsAt > payment.periodStartsAt)
      .sort(
        (a, b) =>
          whole(b) - whole(a) ||
          a.periodStartsAt.getTime() - b.periodStartsAt.getTime() ||
          b.charged - a.charged ||
          this.kept(b) - this.kept(a) ||
          a.transactionId.localeCompare(b.transactionId),
      );

    const periods: BillingPeriod[] = [];
    for (const payment of payments) {
      const holder = periods.find(
        ({ payment: p }) =>
          p.subscriptionId === payment.subscriptionId &&
          p.billingInterval === payment.billingInterval &&
          p.billingFrequency === payment.billingFrequency &&
          p.periodStartsAt < payment.periodEndsAt &&
          p.periodEndsAt > payment.periodStartsAt,
      );
      if (holder && (payment.charged < holder.payment.charged || holder.payment.charged <= 0)) {
        holder.within.push(payment);
      } else periods.push({ payment, within: [] });
    }
    return periods;
  }

  status(payment: Payment): PaymentStatus {
    const returned = this.returned(payment);
    if (returned.chargeback > 0) return 'charged_back';
    const total = sum(Object.values(returned));
    if (total <= 0) return 'paid';
    return total >= payment.charged ? 'refunded' : 'partially_refunded';
  }

  /** The customer's paid time, or null if no payment counts for any time. */
  paidTime(): PaidTime | null {
    const periods = this.billingPeriods();
    const counted = onceEach(
      periods
        .flatMap((period) => {
          const part = this.countedPart(period);
          return part ? [part] : [];
        })
        .sort((a, b) => a.from - b.from || a.to - b.to),
    );
    if (counted.length === 0) return null;

    return {
      startedAt: new Date(counted[0].from),
      billedThrough: new Date(Math.max(...periods.map((period) => period.payment.periodEndsAt.getTime()))),
      counted,
    };
  }

  /** When the paid time served reaches 12 paid months, or null if it does not. */
  vestsAt(paid: PaidTime): Date | null {
    let served = 0;
    for (const { from, to, part } of paid.counted) {
      const months = credit(part, to) - credit(part, from);
      if (served + months >= 12 - MONTHS_EPSILON) {
        const at = monthsFrom(part.periodStart, (credit(part, from) + 12 - served) / part.scale);
        return new Date(Math.min(to, Math.max(from, Math.ceil(at.getTime()))));
      }
      served += months;
    }
    return null;
  }

  /**
   * A grant for each annual term: confirmed when paid (from its billing period's start) through the term's end while
   * nothing is returned from any payment of its billing period (`billingPeriods`: the annual payment and any charge
   * within it, such as a prorated top-up), and withdrawn otherwise: as a chargeback if any of them is charged back,
   * else as a refund. A reversal that leaves nothing returned restores it. The money kept still counts as paid time.
   * An annual term is a billing period whose payment is at an offer price that bills yearly, that charged something,
   * and whose period is a whole year: 12 calendar months from its start, so `monthsOf` gives 12. A shorter payment at
   * a yearly price, such as a prorated charge for a plan change, grants no term: it counts only as paid time.
   *
   * vested_entitlements keeps one grant per term start, so of two annual terms with the same start (of two
   * subscriptions), one decides: the one whose payment charged more, then the later-ending, then the one kept over one
   * withdrawn, then the lower transaction id.
   */
  annualTerms(): Grant[] {
    const terms = new Map<number, Grant>();
    for (const period of this.billingPeriods().filter(({ payment }) => this.isAnnualTerm(payment))) {
      const grant = this.annualGrant(period);
      const other = terms.get(grant.startedAt.getTime());
      if (!other || this.decidesTerm(period, grant, other)) terms.set(grant.startedAt.getTime(), grant);
    }
    return [...terms.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }

  // The annual term's grant: withdrawn if money is returned from any payment of its billing period.
  private annualGrant({ payment, within }: BillingPeriod): Grant {
    const returned = [payment, ...within].map((p) => this.returned(p));
    const grant: Grant = {
      kind: 'annual_term',
      startedAt: payment.periodStartsAt,
      vestedThrough: payment.periodEndsAt,
      status: 'confirmed',
      confirmedAt: payment.periodStartsAt,
      transactionId: payment.transactionId,
      withdrawnReason: null,
    };

    if (returned.some((r) => r.chargeback > 0)) return withdraw(grant, 'chargeback');
    if (returned.some((r) => sum(Object.values(r)) > 0)) return withdraw(grant, 'refund');
    return grant;
  }

  private isAnnualTerm(payment: Payment): boolean {
    return (
      this.isOffered(payment) &&
      payment.charged > 0 &&
      isAnnualTerm(payment.billingInterval, payment.billingFrequency) &&
      monthsOf(payment) >= 12
    );
  }

  // Whether the annual term of `period`, whose grant is `grant`, decides its start over `other`, the grant of another
  // annual term with the same start (annualTerms).
  private decidesTerm(period: BillingPeriod, grant: Grant, other: Grant): boolean {
    const otherPayment = this.input.payments.find((p) => p.transactionId === other.transactionId)!;
    const kept = (g: Grant) => (g.status === 'confirmed' ? 1 : 0);
    return (
      (period.payment.charged - otherPayment.charged ||
        grant.vestedThrough.getTime() - other.vestedThrough.getTime() ||
        kept(grant) - kept(other) ||
        other.transactionId!.localeCompare(grant.transactionId!)) > 0
    );
  }

  /** Whether the payment was at one of the prices Pro is offered at. */
  isOffered(payment: Payment): boolean {
    return this.input.offerPriceIds.includes(payment.priceId);
  }

  // The first kept share of the billing period's period, or null if nothing of it is kept or it pays for no months.
  private countedPart(period: BillingPeriod): CountedPart | null {
    const share = this.keptShare(period);
    const { payment } = period;
    const months = monthsOf(payment);
    if (share <= 0 || months <= 0) return null;

    const from = payment.periodStartsAt.getTime();
    const end = payment.periodEndsAt.getTime();
    return {
      periodStart: payment.periodStartsAt,
      from,
      to: share >= 1 ? end : from + Math.floor(share * (end - from)),
      scale: months / calendarMonths(payment.periodStartsAt, end),
    };
  }
}

/**
 * The paid months a payment's billing period pays for: its billing interval's months (12 a year, one a month) times its
 * frequency, whatever the length of the period, as a calendar month runs from 28 to 31 days. A period that covers fewer
 * calendar months than that from its start pays for the calendar months it covers. Nothing for another interval.
 */
export function monthsOf(
  payment: Pick<Payment, 'billingInterval' | 'billingFrequency' | 'periodStartsAt' | 'periodEndsAt'>,
): number {
  return Math.max(
    0,
    Math.min(nominalMonths(payment), calendarMonths(payment.periodStartsAt, payment.periodEndsAt.getTime())),
  );
}

// The months a billing interval pays for: 12 a year and one a month, times the frequency; nothing for another.
function nominalMonths(payment: Pick<Payment, 'billingInterval' | 'billingFrequency'>): number {
  if (payment.billingInterval === 'year') return 12 * payment.billingFrequency;
  return payment.billingInterval === 'month' ? payment.billingFrequency : 0;
}

// The calendar months from `start` to `end`: the whole months (addMonths) and the share of the next one.
function calendarMonths(start: Date, end: number): number {
  if (end <= start.getTime()) return 0;
  let whole = 0;
  while (addMonths(start, whole + 1).getTime() <= end) whole++;
  const from = addMonths(start, whole).getTime();
  return whole + (end - from) / (addMonths(start, whole + 1).getTime() - from);
}

// The moment `months` calendar months (whole and part) after `start`: the inverse of calendarMonths.
function monthsFrom(start: Date, months: number): Date {
  const whole = Math.floor(months);
  const from = addMonths(start, whole).getTime();
  return new Date(from + (months - whole) * (addMonths(start, whole + 1).getTime() - from));
}

// The paid months a counted part counts for from its start to `at`.
function credit(part: CountedPart, at: number): number {
  return part.scale * calendarMonths(part.periodStart, Math.min(part.to, Math.max(part.from, at)));
}

/**
 * How far the customer is towards vesting, while they have access: their paid months (served or paid ahead), whole,
 * and when they reach 12; or, if they have not been paid that far, when they would if every month from the later of
 * the end of the latest billing period and now were paid in full, so the estimate is never in the past.
 */
function progress(paid: PaidTime, vestsAt: Date | null, now: Date): CurrentRun {
  const months = sum(paid.counted.map(({ from, to, part }) => credit(part, to) - credit(part, from)));
  return {
    startedAt: paid.startedAt,
    paidThrough: new Date(paid.counted.at(-1)!.to),
    monthsPaid: Math.floor(months + MONTHS_EPSILON),
    vestsAt: vestsAt ?? monthsFrom(new Date(Math.max(paid.billedThrough.getTime(), now.getTime())), 12 - months),
  };
}

// The end of the paid time served by `now`: the latest moment before it that a counted part covers. A part starting at
// `now` has served nothing yet.
function servedThrough(paid: PaidTime, now: number): number {
  const last = paid.counted.filter(({ from }) => from < now).at(-1)!;
  return Math.min(last.to, now);
}

// The counted parts cut where they meet or overlap into stretches, each counted once, by the part that credits it the
// most (the earliest on a tie), in order, so a kept payment can never lower what the others count. Neighbouring
// stretches counted by the same part are joined.
function onceEach(parts: CountedPart[]): Stretch[] {
  const edges = [...new Set(parts.flatMap(({ from, to }) => [from, to]))].sort((a, b) => a - b);
  const stretches: Stretch[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [from, to] = [edges[i], edges[i + 1]];
    const covering = parts.filter((part) => part.from <= from && part.to >= to);
    if (covering.length === 0) continue;
    const gain = (part: CountedPart) => credit(part, to) - credit(part, from);
    const part = covering.reduce((best, next) => (gain(next) > gain(best) ? next : best));
    const last = stretches.at(-1);
    if (last && last.to === from && last.part === part) last.to = to;
    else stretches.push({ from, to, part });
  }
  return stretches;
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
