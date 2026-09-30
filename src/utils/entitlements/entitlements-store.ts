import { createClient } from '@/utils/supabase/server-internal';

/**
 * Service-role data access for the commercial entitlement tables (entitlements, licences,
 * github_links). These run server-side from the webhook/provisioning path and bypass RLS via the
 * service-role key, so they are never exposed to the browser.
 */

export type EntitlementStatus = 'active' | 'grace' | 'revoked';

/**
 * Where the customer's GitHub access stands (`customer_access.github_state`): no grant attempted, an org
 * invitation pending since `githubInvitedAt`, a member of the team, or the last grant attempt failed.
 */
export type GithubState = 'none' | 'invited' | 'active' | 'failed';

export interface CustomerAccessRecord {
  status: EntitlementStatus;
  githubState: GithubState;
  githubInvitedAt: Date | null;
}

/** A subscription's entitlement. GitHub access and the licence are per customer (see customer-access.ts). */
export interface EntitlementRecord {
  customerId: string;
  subscriptionId: string;
  status: EntitlementStatus;
  currentPeriodEndsAt: Date | null;
  /** When the subscription became past due; set exactly while the status is 'grace' (see grace.ts). */
  graceStartedAt: Date | null;
}

/** Returns the customer's email (populated by Paddle customer webhooks), or null if unknown. */
export async function getCustomerEmail(customerId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('customers').select('email').eq('customer_id', customerId).maybeSingle();

  if (error) throw error;

  return data?.email ?? null;
}

/** A linked GitHub account: its durable id, and its login when it was linked or last looked up. */
export interface GithubAccount {
  id: number;
  login: string;
}

/** Returns the customer's linked GitHub account, or null if they have not connected GitHub yet. */
export async function getGithubAccount(customerId: string): Promise<GithubAccount | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('github_links')
    .select('github_id,github_login')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data ? { id: Number(data.github_id), login: data.github_login as string } : null;
}

/** Records the linked account's new login after it was renamed on GitHub. */
export async function setGithubLogin(customerId: string, login: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('github_links').update({ github_login: login }).eq('customer_id', customerId);

  if (error) throw error;
}

/** Inserts or updates the entitlement for a subscription (idempotent on subscription_id). */
export async function upsertEntitlement(record: EntitlementRecord): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from('entitlements').upsert(
    {
      customer_id: record.customerId,
      subscription_id: record.subscriptionId,
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

const ENTITLEMENT_COLUMNS = 'customer_id,subscription_id,status,current_period_ends_at,grace_started_at';

/** Returns all of a customer's entitlements, one per subscription. */
export async function listEntitlements(customerId: string): Promise<EntitlementRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('entitlements').select(ENTITLEMENT_COLUMNS).eq('customer_id', customerId);

  if (error) throw error;

  return ((data ?? []) as Record<string, string | null>[]).map(toEntitlement);
}

/** Returns a subscription's entitlement, or null if none is recorded. */
export async function getEntitlement(subscriptionId: string): Promise<EntitlementRecord | null> {
  const supabase = createClient();
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
    status: row.status as EntitlementStatus,
    currentPeriodEndsAt: date(row.current_period_ends_at),
    graceStartedAt: date(row.grace_started_at),
  };
}

/**
 * Records the customer's access (derived from all their entitlements) and returns the status it replaced,
 * 'revoked' for a customer seen for the first time. Ending access also resets the GitHub state to 'none'.
 */
export async function setCustomerAccess(customerId: string, status: EntitlementStatus): Promise<EntitlementStatus> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('set_customer_access', {
    p_customer_id: customerId,
    p_status: status,
  });

  if (error) throw error;

  return data as EntitlementStatus;
}

/** The customer's recorded access, or null for a customer never seen by syncCustomerAccess. */
export async function getCustomerAccess(customerId: string): Promise<CustomerAccessRecord | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('customer_access')
    .select('status,github_state,github_invited_at')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data
    ? {
        status: data.status as EntitlementStatus,
        githubState: data.github_state as GithubState,
        githubInvitedAt: data.github_invited_at ? new Date(data.github_invited_at as string) : null,
      }
    : null;
}

/** Forgets the customer's GitHub state, when their access moves to another GitHub account (relink). */
export async function resetGithubState(customerId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('customer_access')
    .update({ github_state: 'none', github_invited_at: null, updated_at: new Date().toISOString() })
    .eq('customer_id', customerId);

  if (error) throw error;
}

/**
 * Records the outcome of a GitHub grant or membership check, unless the customer's access has since ended
 * (ending it resets the state, and the grant is then removed). 'invited' starts the invitation's clock.
 */
export async function setGithubState(customerId: string, state: Exclude<GithubState, 'none'>): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('customer_access')
    .update({ github_state: state, github_invited_at: state === 'invited' ? now : null, updated_at: now })
    .eq('customer_id', customerId)
    .in('status', ['active', 'grace']);

  if (error) throw error;
}

/** Whether the customer has a licence that is not revoked. */
export async function hasLiveLicence(customerId: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('licences')
    .select('id')
    .eq('customer_id', customerId)
    .eq('revoked', false)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data !== null;
}

/** Records a freshly issued licence token for a customer. */
export async function recordLicence(params: { customerId: string; jwt: string }): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase.from('licences').insert({ customer_id: params.customerId, jwt: params.jwt });

  if (error) throw error;
}

/** Marks all of a customer's licences as revoked, when their access ends. */
export async function revokeLicences(customerId: string): Promise<void> {
  const supabase = createClient();

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
  const supabase = createClient();
  const { data, error: rpcError } = await supabase.rpc('record_licence_failure', {
    p_customer_id: customerId,
    p_error: error,
  });

  if (rpcError) throw rpcError;

  return data === true;
}

/** Forgets a customer's licence failures, once their licence is issued or no longer needed. */
export async function clearLicenceFailure(customerId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('licence_failures').delete().eq('customer_id', customerId);

  if (error) throw error;
}
