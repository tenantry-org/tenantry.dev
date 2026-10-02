import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import { createServiceRoleClient } from '@/server/db/service-role-client';
import type { Tables } from '@/lib/supabase/database.types';

/**
 * Service-role data access for the commercial tables: customers and subscriptions (as Paddle's events left them),
 * entitlements, customer_access, github_links, licences and licence_failures. It runs server-side, from the
 * webhook, reconcile and account-linking paths (src/server/billing), and bypasses RLS with the service-role key. Only
 * the modules in src/server/db query the database (eslint.config.mjs); this one maps these tables' rows to the types
 * below in one place.
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

/**
 * An entitlement: a subscription's, or one granted by hand without a subscription (`subscriptionId` null). GitHub
 * access and the licence are per customer (see customer-access.ts).
 */
export interface EntitlementRecord {
  customerId: string;
  subscriptionId: string | null;
  status: EntitlementStatus;
  currentPeriodEndsAt: Date | null;
  /** When the subscription became past due; set exactly while the status is 'grace' (see access-policy.ts). */
  graceStartedAt: Date | null;
}

/** A subscription's entitlement, the kind Paddle's events record. */
export type SubscriptionEntitlement = EntitlementRecord & { subscriptionId: string };

/** Returns the customer's email (populated by Paddle customer webhooks), or null if unknown. */
export async function getCustomerEmail(customerId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('customers').select('email').eq('customer_id', customerId).maybeSingle();

  if (error) throw error;

  return data?.email ?? null;
}

/** The customer with this (normalised) email, or null: only purchasers have a customer row. */
export async function findCustomerIdByEmail(email: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('customers').select('customer_id').eq('email', email).maybeSingle();

  if (error) throw error;

  return data?.customer_id ?? null;
}

/**
 * Records the customer's email as of one of their Paddle events, unless a newer event for the customer has
 * already been applied (`record_customer_event`). Returns whether it was applied.
 */
export async function recordCustomerEvent(event: {
  customerId: string;
  email: string;
  occurredAt: string;
}): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('record_customer_event', {
    p_customer_id: event.customerId,
    p_email: event.email,
    p_occurred_at: event.occurredAt,
  });

  if (error) throw error;

  return data === true;
}

/** A subscription as one of its Paddle events describes it. */
export interface SubscriptionEvent {
  subscriptionId: string;
  customerId: string;
  status: SubscriptionStatus;
  priceId: string;
  productId: string;
  /** When a scheduled change takes effect, and what it is (cancel, pause or resume); null when none is scheduled. */
  scheduledChangeAt: string | null;
  scheduledChangeAction: string | null;
  occurredAt: string;
}

/**
 * Records the subscription as of one of its Paddle events, unless a newer event for it has already been applied
 * (`record_subscription_event`). Returns whether it was applied. Throws a foreign-key error if the customer has not
 * been recorded yet.
 */
export async function recordSubscriptionEvent(event: SubscriptionEvent): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('record_subscription_event', {
    p_subscription_id: event.subscriptionId,
    p_customer_id: event.customerId,
    p_status: event.status,
    p_price_id: event.priceId,
    p_product_id: event.productId,
    // The function takes null for no scheduled change; generated argument types are never nullable.
    p_scheduled_change: event.scheduledChangeAt as string,
    p_scheduled_change_action: event.scheduledChangeAction as string,
    p_occurred_at: event.occurredAt,
  });

  if (error) throw error;

  return data === true;
}

/** A linked GitHub account: its durable id, and its login when it was linked or last looked up. */
export interface GithubAccount {
  id: number;
  login: string;
}

/** Returns the customer's linked GitHub account, or null if they have not connected GitHub yet. */
export async function getGithubAccount(customerId: string): Promise<GithubAccount | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('github_links')
    .select('github_id,github_login')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data ? { id: data.github_id, login: data.github_login } : null;
}

/** The customer the GitHub account is linked to, or null if it is linked to none. */
export async function getGithubAccountHolder(githubId: number): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('github_links')
    .select('customer_id')
    .eq('github_id', githubId)
    .maybeSingle();

  if (error) throw error;

  return data?.customer_id ?? null;
}

/**
 * Links the GitHub account to the customer, in place of any account linked before. Returns false if the account
 * is linked to another customer: github_id is unique, so of two concurrent links of one account, one fails.
 */
export async function linkGithubAccount(customerId: string, account: GithubAccount): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('github_links')
    .upsert(
      { customer_id: customerId, github_login: account.login, github_id: account.id },
      { onConflict: 'customer_id' },
    );

  if (error?.code === '23505') return false;
  if (error) throw error;

  return true;
}

/** Records the linked account's new login after it was renamed on GitHub. */
export async function setGithubLogin(customerId: string, login: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('github_links').update({ github_login: login }).eq('customer_id', customerId);

  if (error) throw error;
}

/** Inserts or updates the entitlement for a subscription (idempotent on subscription_id). */
export async function upsertEntitlement(record: SubscriptionEntitlement): Promise<void> {
  const supabase = createServiceRoleClient();
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

/** Returns all of a customer's entitlements: one per subscription, and any granted by hand. */
export async function listEntitlements(customerId: string): Promise<EntitlementRecord[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('entitlements').select(ENTITLEMENT_COLUMNS).eq('customer_id', customerId);

  if (error) throw error;

  return (data ?? []).map(toEntitlement);
}

/** Returns a subscription's entitlement, or null if none is recorded. */
export async function getEntitlement(subscriptionId: string): Promise<SubscriptionEntitlement | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('entitlements')
    .select(ENTITLEMENT_COLUMNS)
    .eq('subscription_id', subscriptionId)
    .maybeSingle();

  if (error) throw error;

  return data ? { ...toEntitlement(data), subscriptionId } : null;
}

type EntitlementRow = Pick<
  Tables<'entitlements'>,
  'customer_id' | 'subscription_id' | 'status' | 'current_period_ends_at' | 'grace_started_at'
>;

function toEntitlement(row: EntitlementRow): EntitlementRecord {
  const date = (value: string | null) => (value ? new Date(value) : null);

  return {
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    // entitlements_status_check allows only these.
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
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('set_customer_access', {
    p_customer_id: customerId,
    p_status: status,
  });

  if (error) throw error;

  // set_customer_access returns customer_access.status, which customer_access_status_check limits to these.
  return data as EntitlementStatus;
}

/** The customer's recorded access, or null for a customer never seen by syncCustomerAccess. */
export async function getCustomerAccess(customerId: string): Promise<CustomerAccessRecord | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('customer_access')
    .select('status,github_state,github_invited_at')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data
    ? {
        // customer_access's check constraints allow only these.
        status: data.status as EntitlementStatus,
        githubState: data.github_state as GithubState,
        githubInvitedAt: data.github_invited_at ? new Date(data.github_invited_at) : null,
      }
    : null;
}

/** Forgets the customer's GitHub state, when their access moves to another GitHub account (relink). */
export async function resetGithubState(customerId: string): Promise<void> {
  const supabase = createServiceRoleClient();
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
  const supabase = createServiceRoleClient();
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
  const supabase = createServiceRoleClient();
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
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from('licences').insert({ customer_id: params.customerId, jwt: params.jwt });

  if (error) throw error;
}

/** Marks all of a customer's licences as revoked, when their access ends. */
export async function revokeLicences(customerId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from('licences')
    .update({ revoked: true })
    .eq('customer_id', customerId)
    .eq('revoked', false);

  if (error) throw error;
}

/**
 * Everyone whose access, GitHub membership or licences might need correcting: entitled (by recorded access or by
 * a subscription), linked to GitHub, or holding a live licence. One array, so the API's row limit cannot leave
 * anyone out.
 */
export async function customersToReconcile(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('customers_to_reconcile');

  if (error) throw error;

  return data ?? [];
}

/**
 * Records a failed licence issuance and returns true if it starts a run of failures, the one to alert on
 * (see supabase/migrations/20260928150000_licence_failures.sql).
 */
export async function recordLicenceFailure(customerId: string, error: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error: rpcError } = await supabase.rpc('record_licence_failure', {
    p_customer_id: customerId,
    p_error: error,
  });

  if (rpcError) throw rpcError;

  return data === true;
}

/** Forgets a customer's licence failures, once their licence is issued or no longer needed. */
export async function clearLicenceFailure(customerId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('licence_failures').delete().eq('customer_id', customerId);

  if (error) throw error;
}
