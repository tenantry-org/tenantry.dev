import { createClient } from '@/utils/supabase/server-internal';

/**
 * Service-role data access for the commercial entitlement tables (entitlements, licences,
 * github_links). These run server-side from the webhook/provisioning path and bypass RLS via the
 * service-role key, so they are never exposed to the browser.
 */

export type EntitlementStatus = 'active' | 'grace' | 'revoked';

export interface EntitlementRecord {
  customerId: string;
  subscriptionId: string;
  tier: string;
  status: EntitlementStatus;
  githubGranted: boolean;
}

/** Returns the customer's email (populated by Paddle customer webhooks), or null if unknown. */
export async function getCustomerEmail(customerId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('customers').select('email').eq('customer_id', customerId).maybeSingle();

  if (error) throw error;

  return data?.email ?? null;
}

/** Returns the linked GitHub login for a customer, or null if they have not connected GitHub yet. */
export async function getGithubLogin(customerId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('github_links')
    .select('github_login')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data?.github_login ?? null;
}

/** Inserts or updates the entitlement for a subscription (idempotent on subscription_id). */
export async function upsertEntitlement(record: EntitlementRecord): Promise<void> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from('entitlements').upsert(
    {
      customer_id: record.customerId,
      subscription_id: record.subscriptionId,
      tier: record.tier,
      status: record.status,
      github_granted: record.githubGranted,
      granted_at: record.githubGranted ? now : null,
      revoked_at: record.status === 'revoked' ? now : null,
      updated_at: now,
    },
    { onConflict: 'subscription_id' },
  );

  if (error) throw error;
}

/** Records a freshly issued licence token for a customer. */
export async function recordLicence(params: {
  customerId: string;
  jwt: string;
  tier: string;
  expiresAt: Date;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('licences').insert({
    customer_id: params.customerId,
    jwt: params.jwt,
    tier: params.tier,
    expires_at: params.expiresAt.toISOString(),
  });

  if (error) throw error;
}

/** Marks all of a customer's licences as revoked (e.g. on cancellation past grace). */
export async function revokeLicences(customerId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('licences')
    .update({ revoked: true })
    .eq('customer_id', customerId)
    .eq('revoked', false);

  if (error) throw error;
}
