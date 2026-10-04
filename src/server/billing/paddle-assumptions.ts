import 'server-only';

/**
 * What the entitlement rules assume about Paddle that its documentation does not confirm. Each assumption is here and
 * nowhere else, so a sandbox probe that disproves one changes one place. The plan lists them in section 7.4
 * (plans-and-investigations/Tenantry-Licensing-And-Feed-Plan.md).
 *
 * Not here, because no code depends on it: whether the sandbox lets a subscription's next billing date be brought
 * forward to rehearse a year of renewals. That only decides how the rehearsals are run.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Assumption 1: a renewal that fails and is recovered during Paddle's payment recovery is billed for the period that
 * started on the renewal date, not one that starts when the payment finally succeeds. So a recovered renewal's
 * `billing_period.starts_at` is the previous period's `ends_at`, and the run of consecutive paid periods is unbroken.
 *
 * A paid period continues a run if it starts no later than this long after the run's paid-through time: room for
 * timestamp jitter between Paddle's period boundaries, and no more. A gap of a day breaks the run. If the sandbox shows
 * that a recovered renewal's period starts at the recovery instead, this is where to allow the retry window for a
 * renewal of the same subscription.
 */
export const RUN_CONTINUITY_TOLERANCE_MS = HOUR_MS;

export function continuesRun(paidThrough: Date, periodStartsAt: Date): boolean {
  return periodStartsAt.getTime() <= paidThrough.getTime() + RUN_CONTINUITY_TOLERANCE_MS;
}

/**
 * Assumption 2: the transaction Paddle creates when a subscription changes from monthly to annual with
 * `prorated_immediately` (origin `subscription_update`) carries the new annual term as its `billing_period`, starting
 * at the change. Paddle's docs say the billing period resets to a year from the change; they do not show that
 * transaction's period. Every completed Pro transaction with a billing period is recorded whatever its origin, the
 * annual term overlaps the month in progress, and overlapping periods count once (entitlement-policy.ts), so the
 * month in progress stays counted. A transaction counts as an annual term when its price bills yearly.
 */
export function isAnnualTerm(billingInterval: string, billingFrequency: number): boolean {
  return (
    (billingInterval === 'year' && billingFrequency >= 1) || (billingInterval === 'month' && billingFrequency >= 12)
  );
}

/**
 * Assumption 3: Paddle's hosted customer portal (linked from the billing card) may let a customer pause, or change
 * between monthly and annual at once. Neither is confirmed either way. The rules cope with both:
 *   - a paused subscription ends its paid period at `paused_at`, like a cancellation (`subscriptionEndedAt`), and
 *     resuming starts a new period, so the run breaks;
 *   - an immediate change from annual to monthly credits the unserved part of the annual term, and an approved credit
 *     that is not tax-only withdraws an annual grant as a partial refund does (`CREDIT_IS_PARTIAL_REFUND`).
 * The portal options should still be switched off (LAUNCH-SETUP.md), since a pause resets a customer's run.
 */
export const CREDIT_IS_PARTIAL_REFUND = true;

/** When a cancelled or paused subscription ended, from its Paddle status and timestamps; null while it runs. */
export function subscriptionEndedAt(subscription: {
  status: string;
  canceledAt?: string | null;
  pausedAt?: string | null;
}): string | null {
  if (subscription.status === 'canceled') return subscription.canceledAt ?? null;
  if (subscription.status === 'paused') return subscription.pausedAt ?? null;
  return null;
}

/**
 * Assumption 4: for a subscription started on the 29th to the 31st, Paddle's monthly periods may end on a shorter
 * month's last day and stay on that day, so 12 monthly periods can end up to three days before the calendar date 12
 * months after the start. A run that is that close to 12 months counts as 12 months once its last period is served.
 */
export const MONTH_END_TOLERANCE_MS = 3 * DAY_MS;
