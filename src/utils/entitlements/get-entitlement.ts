import { createClient } from '@/utils/supabase/server';
import { getCustomerId } from '@/utils/paddle/get-customer-id';

/**
 * Read model for the customer-facing Pro access page. Uses the user-scoped client, so RLS guarantees
 * a customer only ever sees their own entitlement / licence / GitHub link.
 */
export interface ProAccess {
  customerId: string | null;
  entitlement: { tier: string; status: string; githubGranted: boolean } | null;
  licence: { jwt: string; tier: string; expiresAt: string } | null;
  githubLogin: string | null;
}

export async function getProAccess(): Promise<ProAccess> {
  const customerId = await getCustomerId();

  if (!customerId) {
    return { customerId: null, entitlement: null, licence: null, githubLogin: null };
  }

  const supabase = await createClient();

  const [{ data: entitlement }, { data: licence }, { data: link }] = await Promise.all([
    supabase
      .from('entitlements')
      .select('tier,status,github_granted')
      .eq('customer_id', customerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('licences')
      .select('jwt,tier,expires_at')
      .eq('customer_id', customerId)
      .eq('revoked', false)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('github_links').select('github_login').eq('customer_id', customerId).maybeSingle(),
  ]);

  return {
    customerId,
    entitlement: entitlement
      ? { tier: entitlement.tier, status: entitlement.status, githubGranted: entitlement.github_granted }
      : null,
    licence: licence ? { jwt: licence.jwt, tier: licence.tier, expiresAt: licence.expires_at } : null,
    githubLogin: link?.github_login ?? null,
  };
}
