import { createClient } from '@/utils/supabase/server';
import { createClient as createServiceClient } from '@/utils/supabase/server-internal';
import { automatedProvisioningEnabled } from '@/utils/provisioning-guard';
import { confirmedEmail } from '@/utils/customers/email';
import { grantAndRecord, isEntitled } from '@/utils/entitlements/customer-access';
import { resetGithubState } from '@/utils/entitlements/entitlements-store';
import { revokeAccess } from '@/utils/github/provisioning';
import { CUSTOMER_BUSY, withCustomerLease } from '@/utils/webhooks/customer-lease';

/**
 * Reconciles the signed-in user's GitHub identity into `github_links` and, if their customer is entitled
 * (any active or grace subscription), grants them access to the private org/feed. This is the step that closes the
 * loop between "customer connected GitHub" and "customer can restore Tenantry.Pro".
 *
 * Safe to call repeatedly (idempotent): from the OAuth callback and from the "Connect GitHub" action.
 * Reads identity with the user-scoped client; writes with the service-role client (RLS has no
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
export const LINK_ERRORS = ['github-account-linked-elsewhere', 'relink-failed', 'link-busy', 'sync-failed'] as const;

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

export async function syncGithubLinkForCurrentUser(): Promise<SyncResult> {
  try {
    return await syncGithubLink();
  } catch (error) {
    console.error('GitHub link sync failed:', error);
    return { linked: false, granted: false, reason: 'sync-failed' };
  }
}

async function syncGithubLink(): Promise<SyncResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { linked: false, granted: false, reason: 'not-authenticated' };
  if (!user.email) return { linked: false, granted: false, reason: 'no-email' };

  const email = confirmedEmail(user);
  if (!email) return { linked: false, granted: false, reason: 'email-not-confirmed' };

  const githubIdentity = user.identities?.find((identity) => identity.provider === 'github');
  if (!githubIdentity) return { linked: false, granted: false, reason: 'no-github-identity' };

  const login = (githubIdentity.identity_data?.user_name ?? githubIdentity.identity_data?.preferred_username) as
    | string
    | undefined;
  const githubId = Number(
    githubIdentity.identity_data?.provider_id ?? githubIdentity.identity_data?.sub ?? githubIdentity.id,
  );

  if (!login || !Number.isFinite(githubId)) {
    return { linked: false, granted: false, reason: 'incomplete-identity' };
  }

  const service = await createServiceClient();

  // Only purchasers have a customer row; until then there is nothing to link to.
  const { data: customer } = await service.from('customers').select('customer_id').eq('email', email).maybeSingle();
  const customerId = customer?.customer_id as string | undefined;

  if (!customerId) return { linked: false, granted: false, reason: 'no-customer' };

  const result = await withCustomerLease(customerId, () => linkAndGrant(customerId, login, githubId));
  return result === CUSTOMER_BUSY ? { linked: false, granted: false, reason: 'link-busy' } : result;
}

// Records the link and grants access if the customer is entitled. Runs holding the customer's lease.
async function linkAndGrant(customerId: string, login: string, githubId: number): Promise<SyncResult> {
  const service = await createServiceClient();

  const [{ data: previous, error: previousError }, { data: holder, error: holderError }] = await Promise.all([
    service.from('github_links').select('github_login,github_id').eq('customer_id', customerId).maybeSingle(),
    service.from('github_links').select('customer_id').eq('github_id', githubId).maybeSingle(),
  ]);

  if (previousError) throw previousError;
  if (holderError) throw holderError;
  if (holder && holder.customer_id !== customerId) {
    return { linked: false, granted: false, reason: 'github-account-linked-elsewhere' };
  }

  // A different GitHub account than before (not a renamed one: the id is stable across renames). Remove
  // the previous account first; if that fails, keep the old link so the user can retry.
  if (previous && Number(previous.github_id) !== githubId) {
    try {
      await revokeAccess(previous.github_login as string);
      await resetGithubState(customerId);
    } catch (error) {
      console.error(`Could not remove the previous GitHub account of customer ${customerId}:`, error);
      return { linked: false, granted: false, reason: 'relink-failed' };
    }
  }

  const { error: linkError } = await service
    .from('github_links')
    .upsert({ customer_id: customerId, github_login: login, github_id: githubId }, { onConflict: 'customer_id' });

  // A concurrent link of the same account to another customer loses the race on github_id's unique index.
  if (linkError?.code === '23505') return { linked: false, granted: false, reason: 'github-account-linked-elsewhere' };
  if (linkError) throw linkError;

  // Grant immediately if the customer is entitled (by any of their subscriptions).
  const { data: access, error: accessError } = await service
    .from('customer_access')
    .select('status')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (accessError) throw accessError;
  if (!access || !isEntitled(access.status)) return { linked: true, granted: false, reason: 'no-active-entitlement' };

  // Same gate as the webhook and reconcile paths: manual mode links the account but leaves the grant to
  // the operator.
  if (!automatedProvisioningEnabled()) return { linked: true, granted: false, reason: 'provisioning-disabled' };

  const state = await grantAndRecord(customerId, login);
  if (state === 'failed') return { linked: true, granted: false, reason: 'grant-failed' };

  return { linked: true, granted: true, invited: state === 'invited' };
}
