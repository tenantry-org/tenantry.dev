import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import { createServiceRoleClient } from '@/server/db/service-role-client';
import { chargedBeforeTax } from '@/server/db/payment-amounts';
import type { Json } from '@/lib/supabase/database.types';
import type { OfferPrices } from '@/lib/public-config';

/**
 * Service-role data access for the commercial tables: customers and subscriptions (as Paddle's events left them), the
 * payment ledger (payments, payment_adjustments), each customer's derived state (active_subscriptions,
 * vested_entitlements), licences and licence_failures. It runs server-side, from the webhook and reconcile paths
 * (src/server/billing), and bypasses RLS with the service-role key. Only
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
  /** The Paddle price paid: only a payment at one of the offer prices (PADDLE_PRICE_MONTHLY or _YEARLY) counts. */
  priceId: string;
  billingInterval: string;
  billingFrequency: number;
  periodStartsAt: Date;
  periodEndsAt: Date;
  /**
   * What the customer was charged for the period before tax, in the currency's lowest unit: Paddle's
   * `details.totals.total` less its `details.totals.tax`, so after any discount. Zero for a trial or a period discounted
   * in full. The same basis as an adjustment's `amount`.
   */
  charged: number;
  /** The currency of `charged`. */
  currencyCode: string;
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
  /**
   * How much it returns (or, for a reversal, restores) before tax, in the currency's lowest unit: Paddle's
   * `totals.subtotal`, which is 0 for a tax-only correction. Null if not recorded (adjustments recorded before amounts
   * were): the entitlement rules then take it to return everything, unless it is tax only.
   */
  amount: number | null;
  /** The currency of `amount`; null if not recorded. One that is not its payment's makes the amount unusable. */
  currencyCode: string | null;
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

export type GrantKind = 'paid_time' | 'annual_term';
export type GrantStatus = 'confirmed' | 'withdrawn';
export type WithdrawnReason = 'refund' | 'chargeback';

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

/**
 * The customer's paid time (entitlement-policy.ts), across all their payments: when it started, the end of the latest
 * paid period, its whole months, and when it reaches (or reached) 12 months.
 */
export interface CurrentRun {
  startedAt: Date;
  paidThrough: Date;
  monthsPaid: number;
  vestsAt: Date;
}

export interface Entitlement {
  access: Access;
  /** Their paid time, or null when the customer has no access or no payment counts for any time. */
  run: CurrentRun | null;
  /** The latest confirmed grant's date, or null if none. */
  vestedThrough: Date | null;
  grants: Grant[];
  /** Each payment's status now. */
  paymentStatuses: Record<string, PaymentStatus>;
  /**
   * The `*_reverse` adjustments that could be a second record of a reversal already marked or the reversal of another
   * adjustment still in force: taken as the first, so they restore nothing, for the operator to check.
   */
  ambiguousReversals: string[];
}

/** Returns the customer's email (populated by Paddle customer webhooks), or null if unknown. */
export async function getCustomerEmail(customerId: string): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('customers').select('email').eq('customer_id', customerId).maybeSingle();

  if (error) throw error;

  return data?.email ?? null;
}

/**
 * Adds the configured offer prices to every price Pro has been offered at (offered_prices), if not there yet. Never
 * removes or changes one, so a price that is no longer offered still counts for the subscribers who pay it.
 */
export async function recordOfferedPrices(prices: OfferPrices): Promise<void> {
  const supabase = createServiceRoleClient();
  const rows = Object.values(prices).map((priceId) => ({ price_id: priceId }));
  const { error } = await supabase
    .from('offered_prices')
    .upsert(rows, { onConflict: 'price_id', ignoreDuplicates: true });

  if (error) throw error;
}

/** Every price Pro has been offered at: a payment counts towards vesting only at one of them. */
export async function listOfferedPriceIds(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('offered_prices').select('price_id');

  if (error) throw error;

  return (data ?? []).map((row) => row.price_id);
}

/** Whether the customer is a test customer the operator keeps for checks (customers.is_test). */
export async function isTestCustomer(customerId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('customers')
    .select('is_test')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) throw error;

  return data?.is_test ?? false;
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
 * Everyone whose access, licence or entitlement might need correcting: entitled (by recorded access or by a
 * subscription), with a failing licence, with paid time stored, or with a payment whose billing period ends after two days
 * ago (paid time still being served). One array, so the API's row limit cannot leave anyone out.
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
  /** details.totals.tax: total less tax is what was charged before tax. */
  tax: number;
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
    p_tax: event.tax,
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
  /** Paddle's totals.subtotal: what it returns before tax, in the currency's lowest unit; null if not given. */
  amount: number | null;
  currencyCode: string | null;
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
    // The function takes null for an amount not given; generated argument types are never nullable.
    p_subtotal: event.amount as number,
    p_currency_code: event.currencyCode as string,
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
    .select(
      'transaction_id,subscription_id,price_id,billing_interval,billing_frequency,period_starts_at,period_ends_at,subtotal,discount,total,tax,currency_code',
    )
    .eq('customer_id', customerId);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    transactionId: row.transaction_id,
    subscriptionId: row.subscription_id,
    priceId: row.price_id,
    billingInterval: row.billing_interval,
    billingFrequency: row.billing_frequency,
    periodStartsAt: new Date(row.period_starts_at),
    periodEndsAt: new Date(row.period_ends_at),
    charged: chargedBeforeTax(row),
    currencyCode: row.currency_code,
  }));
}

/** The adjustments recorded on the customer's transactions. */
export async function listPaymentAdjustments(customerId: string): Promise<PaymentAdjustment[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('payment_adjustments')
    .select('adjustment_id,transaction_id,action,type,item_types,status,approved_at,reversed_at,subtotal,currency_code')
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
    amount: row.subtotal === null ? null : Number(row.subtotal),
    currencyCode: row.currency_code,
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

/** The customer's computed grants as last stored (vested_entitlements, without operator grants). */
export async function listGrants(customerId: string): Promise<Grant[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('vested_entitlements')
    .select('kind,started_at,vested_through,status,confirmed_at,transaction_id,withdrawn_reason')
    .eq('customer_id', customerId)
    .neq('kind', 'operator');

  if (error) throw error;

  // vested_entitlements' check constraints allow only these.
  return (data ?? []).map((row) => ({
    kind: row.kind as GrantKind,
    startedAt: new Date(row.started_at),
    vestedThrough: new Date(row.vested_through),
    status: row.status as GrantStatus,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    transactionId: row.transaction_id,
    withdrawnReason: row.withdrawn_reason as WithdrawnReason | null,
  }));
}

/**
 * Stores the customer's derived state in one transaction (`set_customer_entitlement`): their access and paid time
 * (active_subscriptions), their computed grants (vested_entitlements) and each payment's status. Returns the access
 * status it replaced, 'lapsed' for a customer seen for the first time.
 */
export async function saveCustomerState(customerId: string, entitlement: Entitlement): Promise<AccessStatus> {
  const supabase = createServiceRoleClient();
  const time = (value: Date | null | undefined) => value?.toISOString() ?? null;
  const { run } = entitlement;

  const { data, error } = await supabase.rpc('set_customer_entitlement', {
    p_customer_id: customerId,
    p_state: {
      access_status: entitlement.access.status,
      grace_ends_at: time(entitlement.access.graceEndsAt),
      run_started_at: time(run?.startedAt),
      paid_through: time(run?.paidThrough),
      months_paid: run?.monthsPaid ?? 0,
      vests_at: time(run?.vestsAt),
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
