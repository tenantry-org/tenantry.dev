import { createClient } from '@/utils/supabase/server-internal';
import { grantAccess, hasAccess, revokeAccess } from '@/utils/github/provisioning';
import { provisioningAllowed } from '@/utils/provisioning-guard';
import {
  getCustomerEmail,
  getGithubLogin,
  markGithubGranted,
  revokeLicences,
} from '@/utils/entitlements/entitlements-store';
import { isEntitled, reconcileLicence } from '@/utils/entitlements/customer-access';
import { errorMessage } from '@/utils/errors';

/**
 * Brings GitHub access and licences in line with each customer's recorded access (`customer_access`, see
 * customer-access.ts). Catches what a single webhook can miss:
 *   - a customer who linked GitHub after their access started (grant pending),
 *   - a grant or removal that failed transiently during webhook handling,
 *   - a licence that could not be issued (the failure is recorded in `licence_failures` and alerted on
 *     once), or was never issued because the customer's access started while provisioning was manual,
 *   - licences left live after access ended.
 *
 * It never starts or ends a customer's access, and sends no customer email. Idempotent and safe to run on
 * a schedule (e.g. Vercel Cron hitting /api/reconcile).
 */
export interface ReconcileResult {
  granted: string[];
  revoked: string[];
  licencesIssued: string[];
  licencesRevoked: string[];
  errors: string[];
}

export async function reconcileEntitlements(): Promise<ReconcileResult> {
  const supabase = await createClient();
  const result: ReconcileResult = { granted: [], revoked: [], licencesIssued: [], licencesRevoked: [], errors: [] };

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
      result.errors.push(`grant ${customerId}: ${errorMessage(error)}`);
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
      result.errors.push(`revoke ${link.customer_id}: ${errorMessage(error)}`);
    }
  }

  // 3. Entitled customers whose licence is missing or out of date (tier or billing period) → issue it.
  const { data: entitled, error: entitledError } = await supabase
    .from('customer_access')
    .select('customer_id')
    .in('status', ['active', 'grace']);
  if (entitledError) throw entitledError;

  for (const { customer_id: customerId } of entitled ?? []) {
    try {
      if (!provisioningAllowed(await getCustomerEmail(customerId))) continue;

      const outcome = await reconcileLicence(customerId);
      if (outcome === 'issued') result.licencesIssued.push(customerId);
      if (outcome === 'failed') result.errors.push(`licence ${customerId}: issuance failed (see licence_failures)`);
    } catch (error) {
      result.errors.push(`licence ${customerId}: ${errorMessage(error)}`);
    }
  }

  // 4. Live licences of customers who are not entitled (a revocation that failed, or a licence issued
  //    while their access was ending) → revoke them.
  const { data: licensed, error: licensedError } = await supabase
    .from('licences')
    .select('customer_id')
    .eq('revoked', false);
  if (licensedError) throw licensedError;

  for (const customerId of new Set((licensed ?? []).map((licence) => licence.customer_id as string))) {
    try {
      const { data: access, error } = await supabase
        .from('customer_access')
        .select('status')
        .eq('customer_id', customerId)
        .maybeSingle();
      if (error) throw error;
      if (access && isEntitled(access.status)) continue;

      await revokeLicences(customerId);
      result.licencesRevoked.push(customerId);
    } catch (error) {
      result.errors.push(`licence revocation ${customerId}: ${errorMessage(error)}`);
    }
  }

  return result;
}
