import 'server-only';
import type { CustomerAccessRecord } from '@/server/db/billing-store';
import {
  AccessChange,
  grantAndRecord,
  LicenceOutcome,
  linkedGithubLogin,
  syncCustomerAccess,
} from '@/server/billing/customer-access';
import { isEntitled } from '@/server/billing/access-policy';
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
  licencesRevoked: boolean;
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
 *   - licences left live after access ended.
 *
 * Every step is idempotent, so a job that throws is retried by the inbox with backoff.
 */
export async function reconcileCustomer(
  customerId: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<CustomerReconciliation> {
  const { change, licence } = await syncCustomerAccess(customerId, deps);
  const access = await deps.store.getCustomerAccess(customerId);
  const entitled = access !== null && isEntitled(access.status);
  const githubLogin = await linkedGithubLogin(customerId, deps);
  const result: CustomerReconciliation = { access: change, licence, github: 'unchanged', licencesRevoked: false };

  if (githubLogin) {
    result.github = entitled
      ? await reconcileGrant(customerId, githubLogin, access, deps)
      : await reconcileRemoval(githubLogin, deps);
  }

  if (!entitled && (await deps.store.hasLiveLicence(customerId))) {
    await deps.store.revokeLicences(customerId);
    result.licencesRevoked = true;
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
