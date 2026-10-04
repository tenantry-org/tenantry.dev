import 'server-only';
import type { CustomerAccessRecord } from '@/server/db/billing-store';
import {
  AccessChange,
  grantAndRecord,
  LicenceOutcome,
  linkedGithubLogin,
  syncCustomer,
} from '@/server/billing/customer-access';
import { isEntitled } from '@/server/billing/entitlement-policy';
import { recordCompletedTransaction } from '@/server/billing/apply-paddle-event';
import { PAYMENT_RECOVERY_DAYS } from '@/server/billing/paddle-assumptions';
import type { PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import { errorMessage } from '@/lib/errors';
import { type BillingDeps, defaultBillingDeps } from '@/server/billing/deps';

/**
 * What reconcile did about the customer's GitHub access:
 *   granted    added to the team (a first grant, or a retry of one that failed)
 *   invited    an org invitation was sent where none was pending (a first grant, a retry, one GitHub
 *              dropped after 7 days unaccepted, or a customer removed from the team while entitled)
 *   accepted   a pending invitation was accepted, so the customer is now recorded as a member
 *   removed    a customer who is not entitled was removed from the team or had their invitation cancelled
 *   withheld   a grant was due but automated provisioning is off for this customer
 *   unchanged  nothing to do
 */
export type GithubReconciliation = 'granted' | 'invited' | 'accepted' | 'removed' | 'withheld' | 'unchanged';

export interface CustomerReconciliation {
  access: AccessChange;
  licence: LicenceOutcome | null;
  github: GithubReconciliation;
  /**
   * Completed Pro payments Paddle lists that the ledger was missing (a lost notification), now recorded; null when
   * Paddle could not be asked, which does not stop the rest of the reconcile.
   */
  paymentsRecovered: number | null;
}

/**
 * Brings one customer's access, GitHub membership and licences in line with their entitlements. Catches
 * what a single webhook cannot:
 *   - a past-due subscription whose grace period has ended (there is no Paddle event for that): access
 *     ends, with the revocation email, unless another subscription entitles the customer,
 *   - a licence that is missing or out of date: never issued because access started while provisioning
 *     was manual, or its issuance failed (recorded in `licence_failures` and alerted on once),
 *   - a customer who linked GitHub after their access started (grant pending), or a grant or removal
 *     that failed during webhook handling,
 *   - an org invitation that was accepted (recorded as a member from then on), or that GitHub dropped
 *     after 7 days unaccepted, or a member removed from the team while still entitled (invited again),
 *   - a removal that failed part-way, such as an invitation left pending after leaving the team,
 *   - a completed Pro payment whose transaction.completed notification never arrived or failed for good: Paddle's
 *     completed transactions of the customer's Pro subscriptions are listed, and any missing is recorded. Paddle being
 *     unreachable (or its API key wrong) is alerted on and skipped, so the rest of the reconcile still runs,
 *   - perpetual entitlement that changes with time alone: a run that reaches 12 months or serves another period,
 *     and an annual grant whose term ends (syncCustomer recomputes it).
 *
 * Every step is idempotent, so a job that throws is retried later with backoff.
 */
export async function reconcileCustomer(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<CustomerReconciliation> {
  const paymentsRecovered = await recoverPayments(customerId, deps);
  const { change, licence } = await syncCustomer(customerId, deps);
  const access = await deps.store.getCustomerAccess(customerId);
  const entitled = access !== null && isEntitled(access.status);
  const githubLogin = await linkedGithubLogin(customerId, deps);
  const result: CustomerReconciliation = { access: change, licence, github: 'unchanged', paymentsRecovered };

  if (githubLogin) {
    result.github = entitled
      ? await reconcileGrant(customerId, githubLogin, access, deps)
      : await reconcileRemoval(githubLogin, deps);
  }

  return result;
}

// An entitled customer with a linked account should be a member of the team, or hold a pending invitation.
async function reconcileGrant(
  customerId: string,
  githubLogin: string,
  access: CustomerAccessRecord,
  deps: BillingDeps,
): Promise<GithubReconciliation> {
  const recorded = access.githubState;

  if (recorded === 'invited' || recorded === 'active') {
    const membership = await deps.github.membershipOf(githubLogin);

    if (membership === 'active') {
      if (recorded === 'active') return 'unchanged';
      await deps.store.setGithubState(customerId, 'active');
      return 'accepted';
    }
    if (membership === 'pending') return 'unchanged'; // still waiting for the customer to accept
    // No membership: GitHub dropped the invitation unaccepted, or the customer left or was removed.
  }

  // Honour the provisioning gate, so reconcile cannot backfill a grant the webhook withheld.
  if (deps.config.provisioning !== 'auto') return 'withheld';

  const state = await grantAndRecord(customerId, githubLogin, deps);
  if (state === 'failed') throw new Error(`GitHub grant failed for customer ${customerId}`);

  return state === 'active' ? 'granted' : 'invited';
}

// A customer who is not entitled must not be in the team, or hold an invitation they could still accept.
// The invitation is checked even without a membership: a removal that failed between leaving the team and
// cancelling the invitation leaves only the invitation.
async function reconcileRemoval(githubLogin: string, deps: BillingDeps): Promise<GithubReconciliation> {
  const { github } = deps;
  if ((await github.membershipOf(githubLogin)) === null && !(await github.hasPendingInvitation(githubLogin))) {
    return 'unchanged';
  }

  await github.revokeAccess(githubLogin);
  return 'removed';
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
async function recoverPayments(customerId: string, deps: BillingDeps): Promise<number | null> {
  const { store } = deps;
  const subscriptionIds = (await store.listSubscriptions(customerId))
    .filter((subscription) => subscription.productId === deps.config.paddle.proProductId)
    .map((subscription) => subscription.subscriptionId);
  if (subscriptionIds.length === 0) return 0;

  const since = new Date(Date.now() - PAYMENT_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
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
    if (known.has(transaction.id) || transaction.customerId !== customerId) continue;
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

async function alertPaddleUnreachable(error: unknown, deps: BillingDeps) {
  const now = Date.now();
  if (lastRecoveryAlertAt !== null && now - lastRecoveryAlertAt < RECOVERY_ALERT_INTERVAL_MS) return;
  lastRecoveryAlertAt = now;

  await deps.alertOperator(
    'Reconcile cannot list payments from Paddle',
    `Listing completed transactions failed: ${errorMessage(error)}. Reconcile carries on without it (access, grace, ` +
      'vesting and GitHub are still reconciled), but a payment whose notification was lost is not recorded until it ' +
      "works again. Check PADDLE_API_KEY and Paddle's status. No further alert is sent from this process for six hours.",
  );
}
