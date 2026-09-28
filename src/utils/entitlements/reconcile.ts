import { createClient } from '@/utils/supabase/server-internal';
import { grantAccess, hasAccess, revokeAccess } from '@/utils/github/provisioning';
import { provisioningAllowed } from '@/utils/provisioning-guard';
import { getCustomerEmail, getGithubLogin, markGithubGranted } from '@/utils/entitlements/entitlements-store';
import { isEntitled } from '@/utils/entitlements/customer-access';

/**
 * Brings GitHub access in line with each customer's recorded access (`customer_access`, see
 * customer-access.ts). Catches what a single webhook can miss:
 *   - a customer who linked GitHub after their access started (grant pending),
 *   - a grant or removal that failed transiently during webhook handling.
 *
 * It never starts or ends a customer's access, and sends no email. Idempotent and safe to run on a
 * schedule (e.g. Vercel Cron hitting /api/reconcile).
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
    .from('customer_access')
    .select('customer_id')
    .in('status', ['active', 'grace'])
    .eq('github_granted', false);
  if (pendingError) throw pendingError;

  for (const { customer_id: customerId } of pending ?? []) {
    try {
      const login = await getGithubLogin(customerId);
      if (!login) continue;

      // Honour the provisioning gate (PROVISIONING_MODE + allowlist) so reconcile can't backfill a grant
      // the webhook withheld.
      if (!provisioningAllowed(await getCustomerEmail(customerId))) continue;

      await grantAccess(login);
      await markGithubGranted(customerId);
      result.granted.push(customerId);
    } catch (error) {
      result.errors.push(`grant ${customerId}: ${String(error)}`);
    }
  }

  // 2. Linked customers who are not entitled but are still in the team → remove them.
  const { data: links, error: linksError } = await supabase.from('github_links').select('customer_id, github_login');
  if (linksError) throw linksError;

  for (const link of links ?? []) {
    try {
      const { data: access, error } = await supabase
        .from('customer_access')
        .select('status')
        .eq('customer_id', link.customer_id)
        .maybeSingle();
      if (error) throw error;
      if (access && isEntitled(access.status)) continue; // still entitled

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
