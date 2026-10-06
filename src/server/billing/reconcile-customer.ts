import 'server-only';
import { type AccessChange, type LicenceOutcome, syncCustomer } from '@/server/billing/customer-access';
import {
  applyAdjustmentConsequences,
  recordAdjustment,
  recordCompletedTransaction,
  recordSubscription,
} from '@/server/billing/apply-paddle-event';
import { PAYMENT_RECOVERY_DAYS } from '@/server/billing/paddle-assumptions';
import type { Entitlement, SubscriptionState } from '@/server/db/billing-store';
import type { PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import type { PaddleAdjustment } from '@/server/integrations/paddle/list-adjustments';
import type { PaddleSubscription } from '@/server/integrations/paddle/get-subscription';
import { errorMessage } from '@/lib/errors';
import { type BillingDeps, defaultBillingDeps } from '@/server/billing/deps';

export interface CustomerReconciliation {
  access: AccessChange;
  licence: LicenceOutcome | null;
  /**
   * Running Pro subscriptions whose status in Paddle differed from the one recorded (a lost notification), now
   * recorded; null when Paddle could not be asked, which does not stop the rest of the reconcile.
   */
  subscriptionsRecovered: number | null;
  /** Completed Pro payments Paddle lists that the ledger was missing, now recorded; null likewise. */
  paymentsRecovered: number | null;
  /** Adjustments Paddle lists that the ledger was missing or held in an older state, now recorded; null likewise. */
  adjustmentsRecovered: number | null;
}

/** The statuses of a subscription that may entitle, which reconcile reads from Paddle (customers_to_reconcile). */
const RUNNING_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * Brings one customer's access, entitlement and licence in line with what is recorded, and what is recorded in line
 * with Paddle. Catches what a single webhook cannot:
 *   - a past-due subscription whose grace period has ended (there is no Paddle event for that): access ends, with the
 *     access-ended email, unless another subscription entitles the customer,
 *   - a licence that is missing: never issued because access started while provisioning was manual, or its issuance
 *     failed (recorded in `licence_failures` and alerted on once),
 *   - a subscription whose cancellation, pause or failed payment was never recorded because its notification never
 *     arrived or failed for good: each Pro subscription recorded as active, trialing or past due is read from Paddle
 *     and recorded as it is now. Paddle being unreachable (or its API key wrong) is alerted on and skipped, so the rest
 *     of the reconcile still runs,
 *   - a completed Pro payment whose transaction.completed notification never arrived or failed for good: Paddle's
 *     completed transactions of the customer's Pro subscriptions are listed, and any missing is recorded,
 *   - a refund, credit or chargeback whose adjustment notification never arrived or failed: the adjustments of the
 *     same subscriptions created in the same window are listed, and any missing, or recorded in an older state, is
 *     recorded and acted on as the webhook would (an approved full refund or chargeback cancels the subscription),
 *   - entitlement that changes with time alone: paid time served that reaches 12 paid months or serves another period
 *     (syncCustomer recomputes it, and tells the customer about a grant confirmed or withdrawn).
 *
 * Every step is idempotent, so a job that throws is retried later with backoff.
 */
export async function reconcileCustomer(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<CustomerReconciliation> {
  const subscriptions = (await deps.store.listSubscriptions(customerId)).filter(
    (subscription) => subscription.productId === deps.config.paddle.proProductId,
  );
  const subscriptionIds = subscriptions.map((subscription) => subscription.subscriptionId);
  const subscriptionsRecovered = await recoverSubscriptions(customerId, subscriptions, deps);
  const paymentsRecovered = await recoverPayments(customerId, subscriptionIds, deps);
  const adjustments = await recoverAdjustments(customerId, subscriptionIds, deps);
  const { change, licence, entitlement } = await syncCustomer(customerId, deps);
  for (const adjustment of adjustments ?? []) await actOnAdjustment(customerId, adjustment, entitlement, deps);

  return {
    access: change,
    licence,
    subscriptionsRecovered,
    paymentsRecovered,
    adjustmentsRecovered: adjustments === null ? null : adjustments.length,
  };
}

/** How often a reconcile process alerts that Paddle cannot be reached: once per outage, not once per customer. */
const RECOVERY_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastRecoveryAlertAt: number | null = null;

/** Forgets when the last "cannot reach Paddle" alert was sent, for tests. */
export function resetRecoveryAlerts() {
  lastRecoveryAlertAt = null;
}

// Records each of the customer's running Pro subscriptions as Paddle holds it now, through the webhook's own path
// (recordSubscription, as of Paddle's updatedAt, so a newer recorded event is kept: paddle-assumptions.ts, assumption
// 9), and returns how many changed status. The operator is told of each change: it means a notification was lost.
// Paddle unreachable is handled as in recoverPayments.
async function recoverSubscriptions(
  customerId: string,
  subscriptions: SubscriptionState[],
  deps: BillingDeps,
): Promise<number | null> {
  const running = subscriptions.filter((subscription) => RUNNING_STATUSES.includes(subscription.status));
  if (running.length === 0) return 0;

  let current: PaddleSubscription[];
  try {
    current = await Promise.all(running.map((subscription) => deps.getSubscription(subscription.subscriptionId)));
  } catch (error) {
    console.error(`Reconcile: could not read Paddle subscriptions for customer ${customerId}:`, error);
    await alertPaddleUnreachable(error, deps);
    return null;
  }

  const changed: string[] = [];
  let pastDue = false;
  for (const [i, subscription] of current.entries()) {
    const recordedStatus = running[i].status;
    if (subscription.customerId !== customerId) continue;
    if (!(await recordSubscription(subscription, subscription.updatedAt, deps))) continue;
    if (subscription.status === recordedStatus) continue;
    changed.push(`${subscription.id} (recorded ${recordedStatus}, now ${subscription.status})`);
    pastDue ||= subscription.status === 'past_due';
  }

  if (changed.length > 0) {
    await deps.alertOperator(
      `Recovered ${changed.length} subscription status${changed.length === 1 ? '' : 'es'} for customer ${customerId}`,
      `Reconcile found Pro subscriptions whose status in Paddle differs from the one recorded, and recorded ` +
        `Paddle's: ${changed.join(', ')}. Their subscription notifications were lost or failed, or are still on ` +
        'their way; check the notification destination and customer_jobs.' +
        (pastDue
          ? ' A subscription recorded as past due this way is in grace from when Paddle last updated it, which can ' +
            'be later than the payment that failed. Paddle cancels or pauses it when its payment recovery ends, ' +
            'and reconcile records that.'
          : ''),
    );
  }

  return changed.length;
}

// Records the completed Pro payments of the customer's Pro subscriptions that Paddle lists and the ledger is missing,
// through the webhook's own path, and returns how many. The operator
// is told: a lost notification is worth knowing about. Paddle unreachable is logged and alerted on (at most once in
// RECOVERY_ALERT_INTERVAL_MS per process) and returns null, so it never stops the reconcile; the next run tries again.
async function recoverPayments(
  customerId: string,
  subscriptionIds: string[],
  deps: BillingDeps,
): Promise<number | null> {
  const { store } = deps;
  if (subscriptionIds.length === 0) return 0;

  const since = recoveryWindowStart();
  let listed: PaddleTransaction[];
  try {
    listed = await deps.listCompletedTransactions(subscriptionIds, since);
  } catch (error) {
    console.error(`Reconcile: could not list Paddle transactions for customer ${customerId}:`, error);
    await alertPaddleUnreachable(error, deps);
    return null;
  }

  const known = new Set((await store.listPayments(customerId)).map((payment) => payment.transactionId));
  const recovered: string[] = [];
  for (const transaction of listed) {
    // Only a completed transaction is a payment, whatever the listing returned; and each is recorded once.
    if (transaction.status !== 'completed' || transaction.customerId !== customerId) continue;
    if (known.has(transaction.id)) continue;
    known.add(transaction.id);
    if (await recordCompletedTransaction(transaction, transaction.updatedAt, deps)) recovered.push(transaction.id);
  }

  if (recovered.length > 0) {
    await deps.alertOperator(
      `Recovered ${recovered.length} payment${recovered.length === 1 ? '' : 's'} for customer ${customerId}`,
      `Reconcile found completed Pro transactions in Paddle that the payment ledger was missing, and recorded them: ` +
        `${recovered.join(', ')}. Their transaction.completed notifications were lost or failed; check the ` +
        'notification destination and customer_jobs.',
    );
  }

  return recovered.length;
}

// Records the adjustments of the customer's Pro subscriptions, created in the recovery window, that Paddle lists and
// the ledger is missing or holds in another state, through the webhook's own path (recordAdjustment, whose ordering
// guard keeps a newer recorded state), and returns those it recorded, for reconcile to act on once the customer is in
// line. Paddle unreachable is handled as for payments.
async function recoverAdjustments(
  customerId: string,
  subscriptionIds: string[],
  deps: BillingDeps,
): Promise<PaddleAdjustment[] | null> {
  if (subscriptionIds.length === 0) return [];

  let listed: PaddleAdjustment[];
  try {
    listed = await deps.listAdjustments(subscriptionIds);
  } catch (error) {
    console.error(`Reconcile: could not list Paddle adjustments for customer ${customerId}:`, error);
    await alertPaddleUnreachable(error, deps);
    return null;
  }

  const since = recoveryWindowStart().getTime();
  const recorded = new Map((await deps.store.listPaymentAdjustments(customerId)).map((a) => [a.adjustmentId, a]));
  const seen = new Set<string>();
  const recovered: PaddleAdjustment[] = [];
  for (const adjustment of listed) {
    if (adjustment.customerId !== customerId || seen.has(adjustment.id)) continue;
    seen.add(adjustment.id);
    if (new Date(adjustment.createdAt).getTime() < since) continue;
    const existing = recorded.get(adjustment.id);
    if (existing && existing.status === adjustment.status && existing.amount !== null) continue;
    if (await recordAdjustment(adjustment, adjustment.updatedAt, deps)) recovered.push(adjustment);
  }

  if (recovered.length > 0) {
    await deps.alertOperator(
      `Recovered ${recovered.length} adjustment${recovered.length === 1 ? '' : 's'} for customer ${customerId}`,
      `Reconcile found refunds, credits or chargebacks in Paddle that the payment ledger was missing or held in an ` +
        `older state, and recorded them: ${recovered.map((adjustment) => adjustment.id).join(', ')}. Their ` +
        'adjustment notifications were lost or failed; check the notification destination and customer_jobs.',
    );
  }

  return recovered;
}

// Acts on a recovered adjustment as the webhook would (applyAdjustmentConsequences), once the customer is in line. It
// is recorded already, so a later reconcile would not act on it again: a failure is alerted on rather than thrown.
async function actOnAdjustment(
  customerId: string,
  adjustment: PaddleAdjustment,
  entitlement: Entitlement,
  deps: BillingDeps,
) {
  try {
    await applyAdjustmentConsequences(adjustment, entitlement, deps);
  } catch (error) {
    console.error(`Reconcile: acting on adjustment ${adjustment.id} for customer ${customerId} failed:`, error);
    await deps.alertOperator(
      `Reconcile could not act on adjustment ${adjustment.id} for customer ${customerId}`,
      `Adjustment ${adjustment.id} (${adjustment.type} ${adjustment.action}, ${adjustment.status}) on transaction ` +
        `${adjustment.transactionId} is recorded, but acting on it failed: ${errorMessage(error)}. It is not tried ` +
        'again. If it is an approved full refund or chargeback, cancel its subscription in Paddle.',
    );
  }
}

function recoveryWindowStart(): Date {
  return new Date(Date.now() - PAYMENT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
}

async function alertPaddleUnreachable(error: unknown, deps: BillingDeps) {
  const now = Date.now();
  if (lastRecoveryAlertAt !== null && now - lastRecoveryAlertAt < RECOVERY_ALERT_INTERVAL_MS) return;
  lastRecoveryAlertAt = now;

  await deps.alertOperator(
    'Reconcile cannot reach Paddle',
    `Reading subscriptions, transactions or adjustments failed: ${errorMessage(error)}. Reconcile carries on without ` +
      'them (access, grace and vesting are still reconciled from what is recorded), but a subscription status, ' +
      'payment or adjustment whose notification was lost is not recorded until it works again. Check PADDLE_API_KEY ' +
      "and Paddle's status. No further alert is sent from this process for six hours.",
  );
}
