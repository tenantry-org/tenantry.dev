import 'server-only';
import { confirmedEmail } from '@/server/db/customer-email';
import { CUSTOMER_BUSY } from '@/server/jobs/customer-lease';
import { grantAndRecord } from '@/server/billing/customer-access';
import { isEntitled } from '@/server/billing/access-policy';
import { type BillingDeps, defaultBillingDeps } from '@/server/billing/deps';

/**
 * Reconciles the signed-in user's GitHub identity into `github_links` and, if their customer is entitled
 * (any active or grace subscription), grants them access to the private org/feed. This is the step that closes the
 * loop between "customer connected GitHub" and "customer can restore Tenantry.Pro".
 *
 * Safe to call repeatedly (idempotent): from the OAuth callback and from the "Connect GitHub" action.
 * Reads identity from the user's session; records the link through the service-role store (RLS has no
 * INSERT/UPDATE policy for authenticated users). The user is matched to a customer by their confirmed
 * email only: anyone can sign up with a purchaser's address, but only the purchaser can confirm it.
 *
 * One GitHub account belongs to at most one customer, so an account already linked to another customer is
 * refused. Linking a different account than before first removes the previous one from the team (and
 * cancels its invitation), so a relink cannot leave two accounts with access. The link is changed holding the
 * customer's lease (customer-lease.ts), so no Paddle event or reconcile job for the customer runs meanwhile:
 * otherwise a reconcile could read the previous link and add the previous account back. Never throws:
 * failures are logged and returned as a reason, which the portal shows.
 */
/** Link outcomes the portal explains to the customer (`/dashboard/pro?error=<reason>`). */
export const LINK_ERRORS = [
  'github-account-linked-elsewhere',
  'github-account-deleted',
  'relink-failed',
  'link-busy',
  'sync-failed',
] as const;

export function isLinkError(reason: string | undefined): reason is (typeof LINK_ERRORS)[number] {
  return (LINK_ERRORS as readonly string[]).includes(reason ?? '');
}

export interface SyncResult {
  linked: boolean;
  /** Added to the team, or sent an org invitation to accept (`invited`). */
  granted: boolean;
  invited?: boolean;
  reason?: string;
}

export async function syncGithubLinkForCurrentUser(deps: BillingDeps = defaultBillingDeps): Promise<SyncResult> {
  try {
    return await syncGithubLink(deps);
  } catch (error) {
    console.error('GitHub link sync failed:', error);
    return { linked: false, granted: false, reason: 'sync-failed' };
  }
}

async function syncGithubLink(deps: BillingDeps): Promise<SyncResult> {
  const user = await deps.currentUser();

  if (!user) return { linked: false, granted: false, reason: 'not-authenticated' };
  if (!user.email) return { linked: false, granted: false, reason: 'no-email' };

  const email = confirmedEmail(user);
  if (!email) return { linked: false, granted: false, reason: 'email-not-confirmed' };

  const githubIdentity = user.identities?.find((identity) => identity.provider === 'github');
  if (!githubIdentity) return { linked: false, granted: false, reason: 'no-github-identity' };

  // Only the durable id is taken from the identity; the login is looked up from it (linkAndGrant).
  const githubId = Number(
    githubIdentity.identity_data?.provider_id ?? githubIdentity.identity_data?.sub ?? githubIdentity.id,
  );

  if (!Number.isFinite(githubId)) {
    return { linked: false, granted: false, reason: 'incomplete-identity' };
  }

  // Only purchasers have a customer row; until then there is nothing to link to.
  const customerId = await deps.store.findCustomerIdByEmail(email);

  if (!customerId) return { linked: false, granted: false, reason: 'no-customer' };

  const result = await deps.withCustomerLease(customerId, () => linkAndGrant(customerId, githubId, deps));
  return result === CUSTOMER_BUSY ? { linked: false, granted: false, reason: 'link-busy' } : result;
}

// Records the link and grants access if the customer is entitled. Runs holding the customer's lease.
async function linkAndGrant(customerId: string, githubId: number, deps: BillingDeps): Promise<SyncResult> {
  const { store, github } = deps;
  // The identity's login is as of the user's last GitHub sign-in: the account may have been renamed since, or
  // deleted, and its name then taken by someone else. So the login comes from the id, and a deleted account is
  // neither linked nor granted.
  const login = await github.currentLogin(githubId);
  if (login === null) return { linked: false, granted: false, reason: 'github-account-deleted' };

  const [previous, holder] = await Promise.all([
    store.getGithubAccount(customerId),
    store.getGithubAccountHolder(githubId),
  ]);

  if (holder && holder !== customerId) {
    return { linked: false, granted: false, reason: 'github-account-linked-elsewhere' };
  }

  // A different GitHub account than before (not a renamed one: the id is stable across renames). Remove
  // the previous account first, under its current name (it may have been renamed since); if that fails,
  // keep the old link so the user can retry.
  if (previous && previous.id !== githubId) {
    try {
      const previousLogin = await github.currentLogin(previous.id);
      if (previousLogin) await github.revokeAccess(previousLogin); // a deleted account's access went with it
      await store.resetGithubState(customerId);
    } catch (error) {
      console.error(`Could not remove the previous GitHub account of customer ${customerId}:`, error);
      return { linked: false, granted: false, reason: 'relink-failed' };
    }
  }

  // A concurrent link of the same account to another customer loses the race on github_id's unique index.
  if (!(await store.linkGithubAccount(customerId, { id: githubId, login }))) {
    return { linked: false, granted: false, reason: 'github-account-linked-elsewhere' };
  }

  // Grant immediately if the customer is entitled (by any of their subscriptions).
  const access = await store.getCustomerAccess(customerId);
  if (!access || !isEntitled(access.status)) return { linked: true, granted: false, reason: 'no-active-entitlement' };

  // Same gate as the webhook and reconcile paths: manual mode links the account but leaves the grant to
  // the operator.
  if (!deps.automatedProvisioningEnabled()) return { linked: true, granted: false, reason: 'provisioning-disabled' };

  const state = await grantAndRecord(customerId, login, deps);
  if (state === 'failed') return { linked: true, granted: false, reason: 'grant-failed' };

  return { linked: true, granted: true, invited: state === 'invited' };
}
