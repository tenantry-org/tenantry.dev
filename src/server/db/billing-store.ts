import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import { createServiceRoleClient } from '@/server/db/service-role-client';
import type { Json } from '@/lib/supabase/database.types';

/**
 * Service-role data access for the commercial tables: customers and subscriptions (as Paddle's events left them), the
 * payment ledger (payments, payment_adjustments), each customer's derived state (active_subscriptions,
 * vested_entitlements), github_links, licences and licence_failures. It runs server-side, from the
 * webhook, reconcile and account-linking paths (src/server/billing), and bypasses RLS with the service-role key. Only
 * the modules in src/server/db query the database (eslint.config.mjs); this one maps these tables' rows to the types
 * below in one place.
 */

// The records the access and entitlement rules (src/server/billing/entitlement-policy.ts) read and compute. They are
// declared here, with the tables they map to, since the billing layer imports this one and not the other way round.

export type PaymentStatus = 'paid' | 'partially_refunded' | 'refunded' | 'charged_back';

/** A completed Paddle transaction for a billing period of a Pro subscription (`payments`). */
export interface Payment {
  transactionId: string;
  subscriptionId: string;
  billingInterval: string;
  billingFrequency: number;
  periodStartsAt: Date;
  periodEndsAt: Date;
  /** `details.totals.total`, in the currency's lowest unit: zero when the period was fully discounted. */
  total: number;
}

/** A Paddle adjustment to one of the customer's transactions (`payment_adjustments`). */
export interface PaymentAdjustment {
  adjustmentId: string;
  transactionId: string;
  /** Paddle's action: refund, credit, chargeback, chargeback_warning, or a *_reverse. */
  action: string;
  /** full or partial. */
  type: string;
  /** Its items' types (full, partial, tax, proration). */
  itemTypes: string[];
  /** Paddle's status: pending_approval, approved, rejected or reversed. */
  status: string;
  approvedAt: Date | null;
  reversedAt: Date | null;
}

/** One of the customer's subscriptions, as its newest Paddle event left it (`subscriptions`). */
export interface SubscriptionState {
  subscriptionId: string;
  productId: string | null;
  /** Paddle's status: active, trialing, past_due, paused or canceled. */
  status: string;
  /** When it first became past due, while it is (record_subscription_event keeps the first). */
  graceStartedAt: Date | null;
  /** When it ended, if it is cancelled or paused. */
  endedAt: Date | null;
}

export type AccessStatus = 'active' | 'grace' | 'lapsed';

export interface Access {
  status: AccessStatus;
  /** While in grace: when it ends unless a payment recovers (the latest of the past-due subscriptions' ends). */
  graceEndsAt: Date | null;
}

export type GrantKind = 'qualifying_run' | 'annual_term';
export type GrantStatus = 'conditional' | 'confirmed' | 'withdrawn';
export type WithdrawnReason = 'refund' | 'chargeback' | 'term_not_completed';

/** A row of `vested_entitlements`, keyed by kind and start. */
export interface Grant {
  kind: GrantKind;
  startedAt: Date;
  vestedThrough: Date;
  status: GrantStatus;
  confirmedAt: Date | null;
  /** The annual payment, for an annual term. */
  transactionId: string | null;
  withdrawnReason: WithdrawnReason | null;
}

/** The current run: its start, how far it is paid, and when it reaches (or reached) 12 months. */
export interface CurrentRun {
  startedAt: Date;
  paidThrough: Date;
  monthsPaid: number;
  vestsAt: Date;
}

export interface Entitlement {
  access: Access;
  /** The current run, or null when the customer has no access or no paid period continues to now. */
  run: CurrentRun | null;
  /** The term end of an annual grant not yet confirmed. */
  conditionalThrough: Date | null;
  /** The latest confirmed grant's date, or null if none. */
  vestedThrough: Date | null;
  grants: Grant[];
  /** Each payment's status now. */
  paymentStatuses: Record<string, PaymentStatus>;
}

/**
 * Where the customer's GitHub access stands (`active_subscriptions.github_state`): no grant attempted, an org
 * invitation pending since `githubInvitedAt`, a member of the team, or the last grant attempt failed.
 */
export type GithubState = 'none' | 'invited' | 'active' | 'failed';

/** The customer's recorded access and GitHub state (`active_subscriptions`). */
export interface CustomerAccessRecord {
  status: AccessStatus;
  githubState: GithubState;
  githubInvitedAt: Date | null;
}

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
  /** The end of its current billing period, if it has one. */
  currentPeriodEndsAt: string | null;
  /** When it ended, if it is cancelled or paused (paddle-assumptions.ts: subscriptionEndedAt). */
  endedAt: string | null;
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
    p_scheduled_change_at: event.scheduledChangeAt as string,
    p_scheduled_change_action: event.scheduledChangeAction as string,
    p_current_period_ends_at: event.currentPeriodEndsAt as string,
    p_ended_at: event.endedAt as string,
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

/** The customer's recorded access, or null for a customer never seen by syncCustomer. */
export async function getCustomerAccess(customerId: string): Promise<CustomerAccessRecord | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('active_subscriptions')
    .select('access_status,github_state,github_invited_at')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data
    ? {
        // active_subscriptions' check constraints allow only these.
        status: data.access_status as AccessStatus,
        githubState: data.github_state as GithubState,
        githubInvitedAt: data.github_invited_at ? new Date(data.github_invited_at) : null,
      }
    : null;
}

/** Forgets the customer's GitHub state, when their access moves to another GitHub account (relink). */
export async function resetGithubState(customerId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('active_subscriptions')
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
    .from('active_subscriptions')
    .update({ github_state: state, github_invited_at: state === 'invited' ? now : null, updated_at: now })
    .eq('customer_id', customerId)
    .in('access_status', ['active', 'grace']);

  if (error) throw error;
}

/** Whether the customer has been issued a licence. Licences are kept for good, so one is enough. */
export async function hasLicence(customerId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('licences')
    .select('id')
    .eq('customer_id', customerId)
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

/**
 * Everyone whose access, GitHub membership, licence or entitlement might need correcting: entitled (by recorded access
 * or by a subscription), linked to GitHub, with a failing licence, in a current run, or holding an annual grant not yet
 * confirmed. One array, so the API's row limit cannot leave anyone out.
 */
export async function customersToReconcile(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('customers_to_reconcile');

  if (error) throw error;

  return data ?? [];
}

/**
 * Records a failed licence issuance and returns true if it starts a run of failures, the one to alert on
 * (see licence_failures in supabase/migrations/20261002120000_baseline.sql).
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

/** A completed Pro transaction, as its transaction.completed event describes it (`record_payment`). */
export interface PaymentEvent {
  transactionId: string;
  customerId: string;
  subscriptionId: string;
  origin: string;
  priceId: string;
  billingInterval: string;
  billingFrequency: number;
  periodStartsAt: string;
  periodEndsAt: string;
  /** details.totals, in the currency's lowest unit. */
  subtotal: number;
  discount: number;
  total: number;
  currencyCode: string;
  occurredAt: string;
}

/**
 * Records a completed transaction's payment, unless a newer event for it has been applied (`record_payment`). Returns
 * whether it was applied. Throws a foreign-key error if the customer has not been recorded yet.
 */
export async function recordPayment(event: PaymentEvent): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('record_payment', {
    p_transaction_id: event.transactionId,
    p_customer_id: event.customerId,
    p_subscription_id: event.subscriptionId,
    p_origin: event.origin,
    p_price_id: event.priceId,
    p_billing_interval: event.billingInterval,
    p_billing_frequency: event.billingFrequency,
    p_period_starts_at: event.periodStartsAt,
    p_period_ends_at: event.periodEndsAt,
    p_subtotal: event.subtotal,
    p_discount: event.discount,
    p_total: event.total,
    p_currency_code: event.currencyCode,
    p_occurred_at: event.occurredAt,
  });

  if (error) throw error;

  return data === true;
}

/** An adjustment, as one of its adjustment.created or adjustment.updated events describes it. */
export interface PaymentAdjustmentEvent {
  adjustmentId: string;
  transactionId: string;
  customerId: string;
  subscriptionId: string | null;
  action: string;
  type: string;
  itemTypes: string[];
  status: string;
  /** Paddle's created_at and updated_at on the adjustment. */
  createdAt: string;
  updatedAt: string;
  occurredAt: string;
}

/**
 * Records an adjustment as of one of its events, unless a newer one has been applied (`record_payment_adjustment`).
 * Returns whether anything changed. Throws a foreign-key error if the customer has not been recorded yet.
 */
export async function recordPaymentAdjustment(event: PaymentAdjustmentEvent): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('record_payment_adjustment', {
    p_adjustment_id: event.adjustmentId,
    p_transaction_id: event.transactionId,
    p_customer_id: event.customerId,
    // The function takes null for no subscription; generated argument types are never nullable.
    p_subscription_id: event.subscriptionId as string,
    p_action: event.action,
    p_type: event.type,
    p_item_types: event.itemTypes,
    p_status: event.status,
    p_created_at: event.createdAt,
    p_updated_at: event.updatedAt,
    p_occurred_at: event.occurredAt,
  });

  if (error) throw error;

  return data === true;
}

/** The customer's recorded payments, as the entitlement rules read them. */
export async function listPayments(customerId: string): Promise<Payment[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('payments')
    .select('transaction_id,subscription_id,billing_interval,billing_frequency,period_starts_at,period_ends_at,total')
    .eq('customer_id', customerId);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    transactionId: row.transaction_id,
    subscriptionId: row.subscription_id,
    billingInterval: row.billing_interval,
    billingFrequency: row.billing_frequency,
    periodStartsAt: new Date(row.period_starts_at),
    periodEndsAt: new Date(row.period_ends_at),
    total: Number(row.total),
  }));
}

/** The adjustments recorded on the customer's transactions. */
export async function listPaymentAdjustments(customerId: string): Promise<PaymentAdjustment[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('payment_adjustments')
    .select('adjustment_id,transaction_id,action,type,item_types,status,approved_at,reversed_at')
    .eq('customer_id', customerId);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    adjustmentId: row.adjustment_id,
    transactionId: row.transaction_id,
    action: row.action,
    type: row.type,
    itemTypes: row.item_types,
    status: row.status,
    approvedAt: row.approved_at ? new Date(row.approved_at) : null,
    reversedAt: row.reversed_at ? new Date(row.reversed_at) : null,
  }));
}

/** The customer's subscriptions, as the access and entitlement rules read them. */
export async function listSubscriptions(customerId: string): Promise<SubscriptionState[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('subscription_id,product_id,status,grace_started_at,ended_at')
    .eq('customer_id', customerId);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    subscriptionId: row.subscription_id,
    productId: row.product_id,
    status: row.status,
    graceStartedAt: row.grace_started_at ? new Date(row.grace_started_at) : null,
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
  }));
}

/**
 * Stores the customer's derived state in one transaction (`set_customer_entitlement`): their access and current run
 * (active_subscriptions), their computed grants (vested_entitlements) and each payment's status. Returns the access
 * status it replaced, 'lapsed' for a customer seen for the first time; ending access also resets the GitHub state.
 */
export async function saveCustomerState(customerId: string, entitlement: Entitlement): Promise<AccessStatus> {
  const supabase = createServiceRoleClient();
  const time = (value: Date | null | undefined) => value?.toISOString() ?? null;
  const { run } = entitlement;

  const { data, error } = await supabase.rpc('set_customer_entitlement', {
    p_customer_id: customerId,
    p_state: {
      access_status: entitlement.access.status,
      run_started_at: time(run?.startedAt),
      paid_through: time(run?.paidThrough),
      months_paid: run?.monthsPaid ?? 0,
      vests_at: time(run?.vestsAt),
      conditional_through: time(entitlement.conditionalThrough),
    },
    p_grants: entitlement.grants.map((grant) => ({
      kind: grant.kind,
      started_at: grant.startedAt.toISOString(),
      vested_through: grant.vestedThrough.toISOString(),
      status: grant.status,
      confirmed_at: time(grant.confirmedAt),
      transaction_id: grant.transactionId,
      withdrawn_reason: grant.withdrawnReason,
    })) satisfies Json,
    p_payment_statuses: entitlement.paymentStatuses satisfies Record<string, PaymentStatus> as Json,
  });

  if (error) throw error;

  // set_customer_entitlement returns active_subscriptions.access_status, which its check constraint limits to these.
  return data as AccessStatus;
}
