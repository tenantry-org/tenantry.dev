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
 * `billing_period.starts_at` is the previous period's `ends_at`, and the series of consecutive billing periods is
 * unbroken.
 *
 * A billing period continues a qualifying period if it starts no later than this long after the billing periods so
 * far end: room for timestamp jitter between Paddle's period boundaries, and no more. A gap of a day breaks it. If the sandbox shows
 * that a recovered renewal's period starts at the recovery instead, this is where to allow the retry window for a
 * renewal of the same subscription.
 */
export const RUN_CONTINUITY_TOLERANCE_MS = HOUR_MS;

export function continuesRun(billedThrough: Date, periodStartsAt: Date): boolean {
  return periodStartsAt.getTime() <= billedThrough.getTime() + RUN_CONTINUITY_TOLERANCE_MS;
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
 * between monthly and annual at once. Neither is confirmed either way. The rules cope with both: a pause keeps the
 * paid time already paid for (entitlement-policy.ts counts a payment kept in full for its whole period), and resuming
 * starts a new period; an immediate change from annual to monthly credits the unserved part of the annual term, and a
 * credit is money returned like a refund. The portal options should still be switched off (LAUNCH-SETUP.md).
 */

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

/**
 * Assumption 5: a completed transaction listed through Paddle's API (transactions.list, status completed) is the
 * entity its transaction.completed notification carried, with the same id, billingPeriod, items[].price and
 * details.totals. The SDK's types say so; it has not been compared in the sandbox. Reconcile lists the transactions
 * billed in this many days, for each customer it reconciles, and records any the ledger is missing: a notification
 * lost for longer than that, or for a customer reconcile no longer visits (one who lapsed), is not recovered.
 */
export const PAYMENT_RECOVERY_DAYS = 90;

/**
 * Assumption 6: the amounts. A transaction's `details.totals.total` is "Total after discount and tax" and its
 * `details.totals.tax` the tax, so total less tax is what was charged before tax, after any discount; an adjustment's
 * `totals.subtotal` is "Total before tax. For tax adjustments, the value is 0." (Paddle's API reference). Both are in
 * the transaction's currency (Paddle sets an adjustment's currency to its transaction's) and its lowest unit (stated for
 * transactions; assumed for adjustments, whose reference does not say). The entitlement rules compare the two, so a
 * tax-only correction returns nothing. Not confirmed: that the subtotal of a chargeback_reverse or credit_reverse is the
 * amount it restores, and that a proration credit is in proportion to the time left in the term to within the
 * continuity allowance above (a credit computed by whole days could break a qualifying period at an annual-to-monthly
 * change).
 */
export function adjustmentAmount(totals: { subtotal: string } | null | undefined): number | null {
  if (!totals) return null;
  const amount = Number(totals.subtotal);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

/**
 * Assumption 7: an adjustment listed through Paddle's API (adjustments.list, filtered by subscription) is the entity
 * its adjustment.created and adjustment.updated notifications carried, with the same id, action, type, status, items,
 * totals.subtotal, currency_code, created_at and updated_at; its updated_at orders it against the notifications
 * recorded. The SDK's types say so; it has not been compared in the sandbox. The list has no date filter, so reconcile
 * keeps the adjustments created within PAYMENT_RECOVERY_DAYS.
 */

/**
 * Assumption 8: a reversal. Paddle's adjustments do not say which adjustment a `chargeback_reverse` or `credit_reverse`
 * reverses, and a reversal may be recorded twice: as the original's status `reversed` and as a `*_reverse` adjustment.
 * Assumed, not confirmed: when both record one reversal, the original's updated_at on the reversing event and the
 * reversal's approval are within this window of each other; and a reversal's approval is never more than this window
 * before its original's. A `*_reverse` adjustment approved within it of an original's reversal is taken as a second
 * record of that reversal, unless another adjustment still in force has its amount and the marked one does not. When
 * that does not decide (two chargebacks of one amount, one marked reversed, and a reversal within the window), it is
 * taken as a second record, restoring nothing, and the operator is alerted (entitlement-policy.ts: reversalsOf).
 */
export const REVERSAL_RECORD_WINDOW_MS = HOUR_MS;
