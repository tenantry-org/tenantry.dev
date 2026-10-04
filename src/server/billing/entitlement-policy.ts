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
  WithdrawnReason,
} from '@/server/db/billing-store';
import {
  continuesRun,
  CREDIT_IS_PARTIAL_REFUND,
  isAnnualTerm,
  MONTH_END_TOLERANCE_MS,
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
 * The plan's section 2 (plans-and-investigations/Tenantry-Licensing-And-Feed-Plan.md) states the entitlement rules; in
 * short:
 *
 * - A paid period is a completed Pro payment for a billing period that charged something. It counts from its start to
 *   its end, or until its subscription ended if that was sooner.
 * - A run is a series of paid periods, each starting where the run so far is paid through (paddle-assumptions.ts says
 *   how close). Periods may overlap (a plan change, two subscriptions); a run's length is elapsed time, so an overlap
 *   counts once. Periods of any of the customer's Pro subscriptions can join one run.
 * - A run vests once it has been served for 12 months: at its start plus 12 months (or the end of the period that gets
 *   within a few days of it). From then on each later period of the run that has been served advances the vested date
 *   to its end. The grant is a `qualifying_run`.
 * - An annual payment grants its term at once, conditionally (`annual_term`): confirmed when the term has been served,
 *   withdrawn by a refund, credit or chargeback of that payment approved before then, or if the subscription ended
 *   before the term did.
 * - A period stops counting when a full refund or a chargeback of it is approved. A partial refund or credit leaves a
 *   monthly period counting; an annual term then counts only until that adjustment, and its grant is withdrawn.
 * - Each vesting is decided with the adjustments approved by the moment it was confirmed, so a later refund does not
 *   undo it. A chargeback does while `chargebackUndoesConfirmedVesting` is on (the owner's open question; see
 *   ENTITLEMENT_RULES).
 * - The vested-through date is the latest confirmed grant's. A release is covered when its entitlement date is on or
 *   before it (`coversRelease`).
 *
 * Everything is computed from the ledger each time (customer-access.ts: syncCustomer stores the result), so replaying or reordering
 * Paddle's events cannot change the outcome, and the outcome changes with time alone only as periods are served.
 */

export interface EntitlementInput {
  subscriptions: SubscriptionState[];
  payments: Payment[];
  adjustments: PaymentAdjustment[];
  /** The product that is Tenantry Pro (PADDLE_PRO_PRODUCT_ID): a subscription to any other entitles to nothing. */
  proProductId: string;
  now: Date;
}

export interface EntitlementRules {
  /**
   * Whether a chargeback withdraws vesting that was confirmed before it and relied on the charged-back payment. The
   * owner decided that a charged-back payment does not count towards the 12 months; whether it also undoes vesting
   * already confirmed is open. On: the vesting is decided as if the payment had never counted. Off: a chargeback is
   * treated like a refund, and vesting confirmed before it stands.
   */
  chargebackUndoesConfirmedVesting: boolean;
}

export const ENTITLEMENT_RULES: EntitlementRules = { chargebackUndoesConfirmedVesting: true };

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

export function computeEntitlement(input: EntitlementInput, rules: EntitlementRules = ENTITLEMENT_RULES): Entitlement {
  const access = accessFor(input.subscriptions, input.proProductId, input.now);
  const ledger = new Ledger(input);
  const now = input.now;
  const undo = rules.chargebackUndoesConfirmedVesting;

  // As of each instant, with chargebacks applied as of now when they undo confirmed vesting.
  const runGrants = ledger.qualifyingRuns(undo ? () => now : (at) => at);
  // Withdrawn by a chargeback: the runs that vested as of their own time but not once chargebacks apply throughout.
  const withdrawn = undo
    ? ledger
        .qualifyingRuns((at) => at)
        .filter((run) => !runGrants.some((kept) => kept.startedAt.getTime() === run.startedAt.getTime()))
        .map((run) => ({
          ...run,
          status: 'withdrawn' as const,
          confirmedAt: null,
          withdrawnReason: 'chargeback' as const,
        }))
    : [];
  const annual = ledger.annualTerms(undo);
  const grants = dedupe([...runGrants, ...withdrawn, ...annual]);

  return {
    access,
    run: ledger.currentRun(isEntitled(access.status)),
    conditionalThrough: latest(grants.filter((g) => g.status === 'conditional').map((g) => g.vestedThrough)),
    vestedThrough: latest(grants.filter((g) => g.status === 'confirmed').map((g) => g.vestedThrough)),
    grants,
    paymentStatuses: Object.fromEntries(
      input.payments.map((payment) => [payment.transactionId, ledger.statusAt(payment, now, now)]),
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

interface Period {
  payment: Payment;
  startsAt: Date;
  /** The period's end, or its subscription's end if that came first. */
  endsAt: Date;
}

interface Run {
  startedAt: Date;
  paidThrough: Date;
  periods: Period[];
}

type Effect = 'partial' | 'full' | 'chargeback';

const STATUS_RANK: Record<PaymentStatus, number> = { paid: 0, partially_refunded: 1, refunded: 2, charged_back: 3 };
const EFFECT_STATUS: Record<Effect, PaymentStatus> = {
  partial: 'partially_refunded',
  full: 'refunded',
  chargeback: 'charged_back',
};

class Ledger {
  private readonly adjustments = new Map<string, PaymentAdjustment[]>();
  private readonly endedAt = new Map<string, Date | null>();

  constructor(private readonly input: EntitlementInput) {
    for (const adjustment of input.adjustments) {
      const list = this.adjustments.get(adjustment.transactionId) ?? [];
      list.push(adjustment);
      this.adjustments.set(adjustment.transactionId, list);
    }
    for (const subscription of input.subscriptions) this.endedAt.set(subscription.subscriptionId, subscription.endedAt);
  }

  /**
   * The payment's status at `at`: the strongest adjustment in effect then. A chargeback is judged at `chargebackAt`
   * instead, which is now when chargebacks undo confirmed vesting.
   */
  statusAt(payment: Payment, at: Date, chargebackAt: Date): PaymentStatus {
    let status: PaymentStatus = 'paid';

    for (const adjustment of this.adjustments.get(payment.transactionId) ?? []) {
      const effect = effectOf(adjustment);
      if (!effect) continue;
      if (!this.inEffect(adjustment, effect === 'chargeback' ? chargebackAt : at)) continue;

      const candidate = EFFECT_STATUS[effect];
      if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
    }

    return status;
  }

  /**
   * Every qualifying run, each vested through the latest instant it was confirmed at by now. `chargebackAt` gives the
   * instant chargebacks are judged at for a confirmation at `at`.
   */
  qualifyingRuns(chargebackAt: (at: Date) => Date): Grant[] {
    const now = this.input.now.getTime();
    const grants = new Map<number, Grant>();

    for (const at of this.confirmationInstants()) {
      if (at.getTime() > now) break;

      const run = this.runsAt(at, chargebackAt(at)).findLast(
        (r) => r.startedAt.getTime() <= at.getTime() && at.getTime() <= r.paidThrough.getTime(),
      );
      if (!run) continue;

      const vestsAt = runVestsAt(run);
      if (!vestsAt || vestsAt.getTime() > at.getTime()) continue;
      // Only the 12-month mark and the ends of the run's own periods confirm anything.
      if (at.getTime() !== vestsAt.getTime() && !run.periods.some((p) => p.endsAt.getTime() === at.getTime())) continue;

      const key = run.startedAt.getTime();
      const grant = grants.get(key);
      if (grant) {
        if (at > grant.vestedThrough) grant.vestedThrough = at;
      } else {
        grants.set(key, {
          kind: 'qualifying_run',
          startedAt: run.startedAt,
          vestedThrough: at,
          status: 'confirmed',
          confirmedAt: at,
          transactionId: null,
          withdrawnReason: null,
        });
      }
    }

    return [...grants.values()];
  }

  /** A grant for each annual payment that charged something, conditional until its term has been served. */
  annualTerms(chargebacksUndo: boolean): Grant[] {
    const now = this.input.now;

    return this.input.payments
      .filter((payment) => payment.total > 0 && isAnnualTerm(payment.billingInterval, payment.billingFrequency))
      .map((payment) => {
        const termEnd = payment.periodEndsAt;
        // Adjustments approved by the end of the term (or now, if sooner) decide it; a chargeback at any time if
        // chargebacks undo confirmed vesting.
        const decidedAt = termEnd < now ? termEnd : now;
        const status = this.statusAt(payment, decidedAt, chargebacksUndo ? now : decidedAt);
        const endedAt = this.endedAt.get(payment.subscriptionId) ?? null;

        const grant: Grant = {
          kind: 'annual_term',
          startedAt: payment.periodStartsAt,
          vestedThrough: termEnd,
          status: 'conditional',
          confirmedAt: null,
          transactionId: payment.transactionId,
          withdrawnReason: null,
        };

        if (status === 'charged_back') return withdraw(grant, 'chargeback');
        if (status !== 'paid') return withdraw(grant, 'refund');
        if (endedAt && endedAt < termEnd && endedAt <= now) return withdraw(grant, 'term_not_completed');
        if (termEnd <= now) return { ...grant, status: 'confirmed', confirmedAt: termEnd };

        return grant;
      });
  }

  /** The run that continues to now, if the customer has access: its progress towards 12 months. */
  currentRun(hasAccess: boolean): CurrentRun | null {
    if (!hasAccess) return null;

    const now = this.input.now;
    const run = this.runsAt(now, now).at(-1);
    // A run whose last period ended more than a grace period ago is not continued by anything the customer has now.
    if (!run || run.paidThrough.getTime() + GRACE_PERIOD_DAYS * DAY_MS < now.getTime()) return null;

    return {
      startedAt: run.startedAt,
      paidThrough: run.paidThrough,
      monthsPaid: wholeMonths(run.startedAt, run.paidThrough),
      vestsAt: runVestsAt(run) ?? addMonths(run.startedAt, 12),
    };
  }

  // The runs of the periods that count at `at`, in order.
  private runsAt(at: Date, chargebackAt: Date): Run[] {
    const runs: Run[] = [];

    for (const period of this.periodsCountingAt(at, chargebackAt)) {
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

  private periodsCountingAt(at: Date, chargebackAt: Date): Period[] {
    return this.input.payments
      .flatMap((payment) => {
        const period = this.countedPeriod(payment, this.statusAt(payment, at, chargebackAt), at);
        return period && period.endsAt > period.startsAt ? [period] : [];
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime());
  }

  // The part of a payment's period that is a paid period at `at`, in this status, or null if none is. It charged
  // something; a monthly period counts whole unless refunded in full or charged back; an annual term refunded in full
  // or charged back does not count, and one partially refunded or credited counts until the first such adjustment
  // (its grant is withdrawn all the same: annualTerms).
  private countedPeriod(payment: Payment, status: PaymentStatus, at: Date): Period | null {
    if (payment.total <= 0 || status === 'refunded' || status === 'charged_back') return null;

    const period = this.period(payment);
    if (status !== 'partially_refunded' || !isAnnualTerm(payment.billingInterval, payment.billingFrequency)) {
      return period;
    }

    const partialAt = (this.adjustments.get(payment.transactionId) ?? [])
      .filter((adjustment) => effectOf(adjustment) === 'partial' && this.inEffect(adjustment, at))
      .map((adjustment) => adjustment.approvedAt!.getTime());
    const cut = Math.min(...partialAt);
    return cut < period.endsAt.getTime() ? { ...period, endsAt: new Date(cut) } : period;
  }

  private period(payment: Payment): Period {
    const endedAt = this.endedAt.get(payment.subscriptionId) ?? null;
    const endsAt = endedAt && endedAt < payment.periodEndsAt ? endedAt : payment.periodEndsAt;
    return { payment, startsAt: payment.periodStartsAt, endsAt };
  }

  // Every instant a run could be confirmed at: the end of each period (or where an adjustment cuts one short), and 12
  // months after each period's start (the only instants a run can start at).
  private confirmationInstants(): Date[] {
    const instants = new Set<number>();
    for (const payment of this.input.payments) {
      const period = this.period(payment);
      instants.add(period.endsAt.getTime());
      instants.add(addMonths(period.startsAt, 12).getTime());
    }
    for (const adjustment of this.input.adjustments) {
      if (adjustment.approvedAt) instants.add(adjustment.approvedAt.getTime());
    }
    return [...instants].sort((a, b) => a - b).map((time) => new Date(time));
  }

  // Whether the adjustment applies at `at`: approved by then, and not reversed by then (Paddle marks a reversed
  // chargeback or credit `reversed`, and creates a chargeback_reverse or credit_reverse adjustment).
  private inEffect(adjustment: PaymentAdjustment, at: Date): boolean {
    if (adjustment.status !== 'approved' && adjustment.status !== 'reversed') return false;
    if (!adjustment.approvedAt || adjustment.approvedAt > at) return false;
    if (adjustment.reversedAt && adjustment.reversedAt <= at) return false;

    return !(this.adjustments.get(adjustment.transactionId) ?? []).some(
      (other) =>
        other.action === `${adjustment.action}_reverse` &&
        other.status === 'approved' &&
        other.approvedAt !== null &&
        other.approvedAt <= at,
    );
  }
}

// What an adjustment does to its payment, if anything. A tax-only correction does nothing; warnings and reversals are
// not adjustments of the payment themselves.
function effectOf(adjustment: PaymentAdjustment): Effect | null {
  const taxOnly = adjustment.itemTypes.length > 0 && adjustment.itemTypes.every((type) => type === 'tax');

  switch (adjustment.action) {
    case 'refund':
      if (adjustment.type === 'full') return 'full';
      return taxOnly ? null : 'partial';
    case 'credit':
      if (!CREDIT_IS_PARTIAL_REFUND || taxOnly) return null;
      return adjustment.type === 'full' ? 'full' : 'partial';
    case 'chargeback':
      return 'chargeback';
    default:
      return null;
  }
}

// When the run reaches 12 months, or null if its periods do not get there: 12 calendar months after its start, or the
// end of the first period that gets within the month-end tolerance of that, if sooner. The tolerance is for Paddle's
// month-end renewal dates (paddle-assumptions.ts), so only a period that ends where it was billed to may use it: one cut
// short, by an adjustment or by its subscription ending, must reach the full 12 months.
function runVestsAt(run: Run): Date | null {
  const twelveMonths = addMonths(run.startedAt, 12).getTime();
  const enough = twelveMonths - MONTH_END_TOLERANCE_MS;

  const ends = run.periods.flatMap((period) => {
    const end = period.endsAt.getTime();
    const cut = end < period.payment.periodEndsAt.getTime();
    return end >= (cut ? twelveMonths : enough) ? [end] : [];
  });
  return ends.length === 0 ? null : new Date(Math.min(twelveMonths, ...ends));
}

function withdraw(grant: Grant, reason: WithdrawnReason): Grant {
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
