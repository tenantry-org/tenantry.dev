import { createClient } from '@/utils/supabase/server';
import { createClient as createServiceClient } from '@/utils/supabase/server-internal';
import { grantAccess } from '@/utils/github/provisioning';
import { provisioningAllowed } from '@/utils/provisioning-guard';
import { confirmedEmail } from '@/utils/customers/email';
import { markGithubGranted } from '@/utils/entitlements/entitlements-store';
import { isEntitled } from '@/utils/entitlements/customer-access';

/**
 * Reconciles the signed-in user's GitHub identity into `github_links` and, if their customer is entitled
 * (any active or grace subscription), grants them access to the private org/feed. This is the step that closes the
 * loop between "customer connected GitHub" and "customer can restore Tenantry.Pro".
 *
 * Safe to call repeatedly (idempotent): from the OAuth callback and from the "Connect GitHub" action.
 * Reads identity with the user-scoped client; writes with the service-role client (RLS has no
 * INSERT/UPDATE policy for authenticated users). The user is matched to a customer by their confirmed
 * email only: anyone can sign up with a purchaser's address, but only the purchaser can confirm it.
 */
export interface SyncResult {
  linked: boolean;
  granted: boolean;
  reason?: string;
}

export async function syncGithubLinkForCurrentUser(): Promise<SyncResult> {
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

  const { error: linkError } = await service
    .from('github_links')
    .upsert({ customer_id: customerId, github_login: login, github_id: githubId }, { onConflict: 'customer_id' });

  if (linkError) throw linkError;

  // Grant immediately if the customer is entitled (by any of their subscriptions).
  const { data: access, error: accessError } = await service
    .from('customer_access')
    .select('status')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (accessError) throw accessError;
  if (!access || !isEntitled(access.status)) return { linked: true, granted: false, reason: 'no-active-entitlement' };

  // Same gate as the webhook and reconcile paths: manual mode or a non-allowlisted customer links the
  // account but leaves the grant to the operator.
  if (!provisioningAllowed(email)) return { linked: true, granted: false, reason: 'provisioning-disabled' };

  try {
    await grantAccess(login);
    await markGithubGranted(customerId);

    return { linked: true, granted: true };
  } catch (error) {
    console.error('Failed to grant GitHub access during link sync:', error);
    return { linked: true, granted: false, reason: 'grant-failed' };
  }
}
