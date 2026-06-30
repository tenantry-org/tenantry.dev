import { createClient } from '@/utils/supabase/server';
import { createClient as createServiceClient } from '@/utils/supabase/server-internal';
import { grantAccess } from '@/utils/github/provisioning';

/**
 * Reconciles the signed-in user's GitHub identity into `github_links` and, if they hold an active or
 * grace entitlement, grants them access to the private org/feed. This is the step that closes the
 * loop between "customer connected GitHub" and "customer can restore Tenantry.Pro".
 *
 * Safe to call repeatedly (idempotent): from the OAuth callback and from the "Connect GitHub" action.
 * Reads identity with the user-scoped client; writes with the service-role client (RLS has no
 * INSERT/UPDATE policy for authenticated users).
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
  const { data: customer } = await service
    .from('customers')
    .select('customer_id')
    .eq('email', user.email)
    .maybeSingle();
  const customerId = customer?.customer_id as string | undefined;

  if (!customerId) return { linked: false, granted: false, reason: 'no-customer' };

  const { error: linkError } = await service
    .from('github_links')
    .upsert({ customer_id: customerId, github_login: login, github_id: githubId }, { onConflict: 'customer_id' });

  if (linkError) throw linkError;

  // Grant immediately if there is an entitlement that should have access.
  const { data: entitlement } = await service
    .from('entitlements')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', ['active', 'grace'])
    .limit(1)
    .maybeSingle();

  if (!entitlement) return { linked: true, granted: false, reason: 'no-active-entitlement' };

  try {
    await grantAccess(login);
    const now = new Date().toISOString();
    await service
      .from('entitlements')
      .update({ github_granted: true, granted_at: now, updated_at: now })
      .eq('customer_id', customerId)
      .in('status', ['active', 'grace']);

    return { linked: true, granted: true };
  } catch (error) {
    console.error('Failed to grant GitHub access during link sync:', error);
    return { linked: true, granted: false, reason: 'grant-failed' };
  }
}
