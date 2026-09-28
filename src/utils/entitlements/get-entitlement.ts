import { createClient } from '@/utils/supabase/server';
import { getCustomerId } from '@/utils/paddle/get-customer-id';
import { graceEndsAt } from '@/utils/entitlements/grace';

/**
 * Read model for the customer-facing Pro access page. Uses the user-scoped client, so RLS guarantees
 * a customer only ever sees their own access / licence / GitHub link.
 */
export interface ProAccess {
  customerId: string | null;
  /**
   * The customer's access across all their subscriptions (`customer_access`). While every subscription
   * that entitles them is past due, `grace` says when access ends if no payment recovers, and whether that
   * has passed (access is then removed by the next reconcile).
   */
  entitlement: {
    status: string;
    githubGranted: boolean;
    grace: { endsAt: string; ended: boolean } | null;
  } | null;
  licence: { jwt: string; expiresAt: string } | null;
  githubLogin: string | null;
}

export async function getProAccess(): Promise<ProAccess> {
  const customerId = await getCustomerId();

  if (!customerId) {
    return { customerId: null, entitlement: null, licence: null, githubLogin: null };
  }

  const supabase = await createClient();

  const [{ data: entitlement }, { data: licence }, { data: link }, { data: grace }] = await Promise.all([
    supabase.from('customer_access').select('status,github_granted').eq('customer_id', customerId).maybeSingle(),
    supabase
      .from('licences')
      .select('jwt,expires_at')
      .eq('customer_id', customerId)
      .eq('revoked', false)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('github_links').select('github_login').eq('customer_id', customerId).maybeSingle(),
    supabase.from('entitlements').select('grace_started_at').eq('customer_id', customerId).eq('status', 'grace'),
  ]);

  const graceEnds = (grace ?? []).map(({ grace_started_at }) => graceEndsAt(new Date(grace_started_at)).getTime());
  const graceEnd = graceEnds.length > 0 ? Math.max(...graceEnds) : null;

  return {
    customerId,
    entitlement: entitlement
      ? {
          status: entitlement.status,
          githubGranted: entitlement.github_granted,
          grace:
            entitlement.status === 'grace' && graceEnd !== null
              ? { endsAt: new Date(graceEnd).toISOString(), ended: graceEnd <= Date.now() }
              : null,
        }
      : null,
    licence: licence ? { jwt: licence.jwt, expiresAt: licence.expires_at } : null,
    githubLogin: link?.github_login ?? null,
  };
}
