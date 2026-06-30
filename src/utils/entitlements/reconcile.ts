import { createClient } from '@/utils/supabase/server-internal';
import { grantAccess, hasAccess, revokeAccess } from '@/utils/github/provisioning';

/**
 * Reconciles entitlements ↔ GitHub access. Catches stragglers a single webhook can miss:
 *   - a customer who linked GitHub after their subscription activated (grant pending),
 *   - a grant/revoke that failed transiently during webhook handling.
 *
 * Idempotent and safe to run on a schedule (e.g. Vercel Cron hitting /api/reconcile).
 */
export interface ReconcileResult {
  granted: string[];
  revoked: string[];
  errors: string[];
}

export async function reconcileEntitlements(): Promise<ReconcileResult> {
  const supabase = await createClient();
  const result: ReconcileResult = { granted: [], revoked: [], errors: [] };

  // 1. Entitled (active/grace) but not yet granted, and GitHub is linked → grant.
  const { data: pending, error: pendingError } = await supabase
    .from('entitlements')
    .select('customer_id')
    .in('status', ['active', 'grace'])
    .eq('github_granted', false);
  if (pendingError) throw pendingError;

  for (const entitlement of pending ?? []) {
    const login = await linkedLogin(supabase, entitlement.customer_id);
    if (!login) continue;

    try {
      await grantAccess(login);
      const now = new Date().toISOString();
      await supabase
        .from('entitlements')
        .update({ github_granted: true, granted_at: now, updated_at: now })
        .eq('customer_id', entitlement.customer_id)
        .in('status', ['active', 'grace']);
      result.granted.push(entitlement.customer_id);
    } catch (error) {
      result.errors.push(`grant ${entitlement.customer_id}: ${String(error)}`);
    }
  }

  // 2. Linked customers with NO active/grace entitlement who still have org access → revoke.
  const { data: links, error: linksError } = await supabase.from('github_links').select('customer_id, github_login');
  if (linksError) throw linksError;

  for (const link of links ?? []) {
    const { data: active } = await supabase
      .from('entitlements')
      .select('id')
      .eq('customer_id', link.customer_id)
      .in('status', ['active', 'grace'])
      .limit(1)
      .maybeSingle();
    if (active) continue; // still entitled — leave access in place

    try {
      if (await hasAccess(link.github_login)) {
        await revokeAccess(link.github_login);
        result.revoked.push(link.customer_id);
      }
    } catch (error) {
      result.errors.push(`revoke ${link.customer_id}: ${String(error)}`);
    }
  }

  return result;
}

async function linkedLogin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('github_links')
    .select('github_login')
    .eq('customer_id', customerId)
    .maybeSingle();

  return data?.github_login ?? null;
}
