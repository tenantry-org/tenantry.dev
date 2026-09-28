import { createClient } from '@/utils/supabase/server-internal';

/**
 * Service-role data access for the commercial entitlement tables (entitlements, licences,
 * github_links). These run server-side from the webhook/provisioning path and bypass RLS via the
 * service-role key, so they are never exposed to the browser.
 */

export type EntitlementStatus = 'active' | 'grace' | 'revoked';

/** A subscription's entitlement. GitHub access and the licence are per customer (see customer-access.ts). */
export interface EntitlementRecord {
  customerId: string;
  subscriptionId: string;
  tier: string;
  status: EntitlementStatus;
  currentPeriodEndsAt: Date | null;
  /** When the subscription became past due; set exactly while the status is 'grace' (see grace.ts). */
  graceStartedAt: Date | null;
}

export interface CurrentLicence {
  tier: string;
  expiresAt: Date;
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
      current_period_ends_at: record.currentPeriodEndsAt?.toISOString() ?? null,
      grace_started_at: record.graceStartedAt?.toISOString() ?? null,
      revoked_at: record.status === 'revoked' ? now : null,
      updated_at: now,
    },
    { onConflict: 'subscription_id' },
  );

  if (error) throw error;
}

const ENTITLEMENT_COLUMNS = 'customer_id,subscription_id,tier,status,current_period_ends_at,grace_started_at';

/** Returns all of a customer's entitlements, one per subscription. */
export async function listEntitlements(customerId: string): Promise<EntitlementRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('entitlements').select(ENTITLEMENT_COLUMNS).eq('customer_id', customerId);

  if (error) throw error;

  return ((data ?? []) as Record<string, string | null>[]).map(toEntitlement);
}

/** Returns a subscription's entitlement, or null if none is recorded. */
export async function getEntitlement(subscriptionId: string): Promise<EntitlementRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('entitlements')
    .select(ENTITLEMENT_COLUMNS)
    .eq('subscription_id', subscriptionId)
    .maybeSingle();

  if (error) throw error;

  return data ? toEntitlement(data as Record<string, string | null>) : null;
}

function toEntitlement(row: Record<string, string | null>): EntitlementRecord {
  const date = (value: string | null) => (value ? new Date(value) : null);

  return {
    customerId: row.customer_id as string,
    subscriptionId: row.subscription_id as string,
    tier: row.tier as string,
    status: row.status as EntitlementStatus,
    currentPeriodEndsAt: date(row.current_period_ends_at),
    graceStartedAt: date(row.grace_started_at),
  };
}

/**
 * Records the customer's access (derived from all their entitlements) and returns the status it replaced,
 * 'revoked' for a customer seen for the first time. Ending access also clears `github_granted`.
 */
export async function setCustomerAccess(
  customerId: string,
  status: EntitlementStatus,
  tier: string | null,
): Promise<EntitlementStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_customer_access', {
    p_customer_id: customerId,
    p_status: status,
    p_tier: tier,
  });

  if (error) throw error;

  return data as EntitlementStatus;
}

/** The customer's recorded access, or null for a customer never seen by syncCustomerAccess. */
export async function getCustomerAccess(
  customerId: string,
): Promise<{ status: EntitlementStatus; githubGranted: boolean } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_access')
    .select('status,github_granted')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data ? { status: data.status as EntitlementStatus, githubGranted: data.github_granted as boolean } : null;
}

/** Records that the customer's GitHub account was added to the team, unless their access has since ended. */
export async function markGithubGranted(customerId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('customer_access')
    .update({ github_granted: true, updated_at: new Date().toISOString() })
    .eq('customer_id', customerId)
    .in('status', ['active', 'grace']);

  if (error) throw error;
}

/** The customer's most recently issued licence that is not revoked, or null. */
export async function getCurrentLicence(customerId: string): Promise<CurrentLicence | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('licences')
    .select('tier,expires_at')
    .eq('customer_id', customerId)
    .eq('revoked', false)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data ? { tier: data.tier as string, expiresAt: new Date(data.expires_at as string) } : null;
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

/** Marks all of a customer's licences as revoked, when their access ends. */
export async function revokeLicences(customerId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('licences')
    .update({ revoked: true })
    .eq('customer_id', customerId)
    .eq('revoked', false);

  if (error) throw error;
}

/**
 * Records a failed licence issuance and returns true if it starts a run of failures, the one to alert on
 * (see supabase/migrations/20260928150000_licence_failures.sql).
 */
export async function recordLicenceFailure(customerId: string, error: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error: rpcError } = await supabase.rpc('record_licence_failure', {
    p_customer_id: customerId,
    p_error: error,
  });

  if (rpcError) throw rpcError;

  return data === true;
}

/** Forgets a customer's licence failures, once their licence is issued or no longer needed. */
export async function clearLicenceFailure(customerId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('licence_failures').delete().eq('customer_id', customerId);

  if (error) throw error;
}
