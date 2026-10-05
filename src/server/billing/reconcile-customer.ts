import 'server-only';
import { type AccessChange, type LicenceOutcome, syncCustomer } from '@/server/billing/customer-access';
import { recordAdjustment, recordCompletedTransaction } from '@/server/billing/apply-paddle-event';
import { PAYMENT_RECOVERY_DAYS } from '@/server/billing/paddle-assumptions';
import type { PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import type { PaddleAdjustment } from '@/server/integrations/paddle/list-adjustments';
import { errorMessage } from '@/lib/errors';
import { type BillingDeps, defaultBillingDeps } from '@/server/billing/deps';

export interface CustomerReconciliation {
  access: AccessChange;
  licence: LicenceOutcome | null;
  /**
   * Completed Pro payments Paddle lists that the ledger was missing (a lost notification), now recorded; null when
   * Paddle could not be asked, which does not stop the rest of the reconcile.
   */
  paymentsRecovered: number | null;
  /** Adjustments Paddle lists that the ledger was missing or held in an older state, now recorded; null likewise. */
  adjustmentsRecovered: number | null;
}

/**
 * Brings one customer's access, entitlement and licence in line with what is recorded. Catches what a single webhook
 * cannot:
 *   - a past-due subscription whose grace period has ended (there is no Paddle event for that): access ends, with the
 *     access-ended email, unless another subscription entitles the customer,
 *   - a licence that is missing: never issued because access started while provisioning was manual, or its issuance
 *     failed (recorded in `licence_failures` and alerted on once),
 *   - a completed Pro payment whose transaction.completed notification never arrived or failed for good: Paddle's
 *     completed transactions of the customer's Pro subscriptions are listed, and any missing is recorded. Paddle being
 *     unreachable (or its API key wrong) is alerted on and skipped, so the rest of the reconcile still runs,
 *   - a refund, credit or chargeback whose adjustment notification never arrived or failed: the adjustments of the
 *     same subscriptions created in the same window are listed, and any missing, or recorded in an older state, is
 *     recorded as the webhook would,
 *   - entitlement that changes with time alone: a run that reaches 12 months or serves another period, and an annual
 *     grant whose term ends (syncCustomer recomputes it, and tells the customer about a grant confirmed or withdrawn).
 *
 * Every step is idempotent, so a job that throws is retried later with backoff.
 */
export async function reconcileCustomer(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<CustomerReconciliation> {
  const subscriptionIds = await proSubscriptionIds(customerId, deps);
  const paymentsRecovered = await recoverPayments(customerId, subscriptionIds, deps);
  const adjustmentsRecovered = await recoverAdjustments(customerId, subscriptionIds, deps);
  const { change, licence } = await syncCustomer(customerId, deps);
  return { access: change, licence, paymentsRecovered, adjustmentsRecovered };
}

/** How often a reconcile process alerts that Paddle cannot be asked: once per outage, not once per customer. */
const RECOVERY_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastRecoveryAlertAt: number | null = null;

/** Forgets when the last "cannot list payments" alert was sent, for tests. */
export function resetRecoveryAlerts() {
  lastRecoveryAlertAt = null;
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

// Records the adjustments of the customer's Pro subscriptions, created in the recovery window, that Paddle lists and the
// ledger is missing or holds in another state, through the webhook's own path (recordAdjustment, whose ordering guard
// keeps a newer recorded state), and returns how many changed. Paddle unreachable is handled as for payments.
async function recoverAdjustments(
  customerId: string,
  subscriptionIds: string[],
  deps: BillingDeps,
): Promise<number | null> {
  if (subscriptionIds.length === 0) return 0;

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
  const recovered: string[] = [];
  for (const adjustment of listed) {
    if (adjustment.customerId !== customerId || seen.has(adjustment.id)) continue;
    seen.add(adjustment.id);
    if (new Date(adjustment.createdAt).getTime() < since) continue;
    const existing = recorded.get(adjustment.id);
    if (existing && existing.status === adjustment.status && existing.amount !== null) continue;
    if (await recordAdjustment(adjustment, adjustment.updatedAt, deps)) recovered.push(adjustment.id);
  }

  if (recovered.length > 0) {
    await deps.alertOperator(
      `Recovered ${recovered.length} adjustment${recovered.length === 1 ? '' : 's'} for customer ${customerId}`,
      `Reconcile found refunds, credits or chargebacks in Paddle that the payment ledger was missing or held in an ` +
        `older state, and recorded them: ${recovered.join(', ')}. Their adjustment notifications were lost or failed; ` +
        'check the notification destination and customer_jobs, and whether a subscription should now be cancelled ' +
        '(the webhook cancels one after an approved full refund or chargeback; reconcile does not).',
    );
  }

  return recovered.length;
}

async function proSubscriptionIds(customerId: string, deps: BillingDeps): Promise<string[]> {
  return (await deps.store.listSubscriptions(customerId))
    .filter((subscription) => subscription.productId === deps.config.paddle.proProductId)
    .map((subscription) => subscription.subscriptionId);
}

function recoveryWindowStart(): Date {
  return new Date(Date.now() - PAYMENT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
}

async function alertPaddleUnreachable(error: unknown, deps: BillingDeps) {
  const now = Date.now();
  if (lastRecoveryAlertAt !== null && now - lastRecoveryAlertAt < RECOVERY_ALERT_INTERVAL_MS) return;
  lastRecoveryAlertAt = now;

  await deps.alertOperator(
    'Reconcile cannot list payments from Paddle',
    `Listing transactions or adjustments failed: ${errorMessage(error)}. Reconcile carries on without it (access, ` +
      'grace and vesting are still reconciled), but a payment or adjustment whose notification was lost is not ' +
      'recorded until it ' +
      "works again. Check PADDLE_API_KEY and Paddle's status. No further alert is sent from this process for six hours.",
  );
}
