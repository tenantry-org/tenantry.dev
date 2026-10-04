import 'server-only';
import {
  AdjustmentAction,
  AdjustmentActionType,
  AdjustmentStatus,
  CustomerCreatedEvent,
  CustomerUpdatedEvent,
  EventEntity,
  EventName,
  SubscriptionStatus,
} from '@paddle/paddle-node-sdk';
import { syncCustomer } from '@/server/billing/customer-access';
import type { PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import { subscriptionEndedAt } from '@/server/billing/paddle-assumptions';
import { normaliseEmail } from '@/server/db/customer-email';
import { type BillingDeps, defaultBillingDeps } from '@/server/billing/deps';

// Structural view of the bits of SubscriptionNotification this handler needs.
interface SubscriptionEventData {
  id: string;
  status: SubscriptionStatus;
  customerId: string;
  items: { price?: { id?: string | null; productId?: string | null } | null }[];
  currentBillingPeriod: { endsAt: string } | null;
  scheduledChange: { action?: string; effectiveAt?: string } | null;
  canceledAt: string | null;
  pausedAt: string | null;
}

// Structural view of the bits of AdjustmentNotification this handler needs.
interface AdjustmentEventData {
  id: string;
  action: AdjustmentAction;
  type: AdjustmentActionType;
  status: AdjustmentStatus;
  transactionId: string;
  subscriptionId: string | null;
  customerId: string;
  items: { type: string }[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Applies one Paddle notification. Called by the job worker, one customer's jobs at a time and oldest first; a
 * subscription or customer event older than the last one applied to its subscription or customer changes nothing.
 * Throwing makes the worker retry the event later.
 */
export async function applyPaddleEvent(eventData: EventEntity, deps: BillingDeps = defaultBillingDeps): Promise<void> {
  switch (eventData.eventType) {
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionCanceled:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed:
    case EventName.SubscriptionTrialing:
      await handleSubscription(eventData.data as unknown as SubscriptionEventData, eventData.occurredAt, deps);
      break;
    case EventName.CustomerCreated:
    case EventName.CustomerUpdated:
      await handleCustomer(eventData, deps);
      break;
    case EventName.AdjustmentCreated:
    case EventName.AdjustmentUpdated:
      await handleAdjustment(eventData.data as unknown as AdjustmentEventData, eventData.occurredAt, deps);
      break;
    // The only transaction event that records anything: a payment is final once its transaction is completed. The
    // others (created, ready, billed, paid, past_due, payment_failed, canceled, revised, updated) come before that or
    // change nothing the entitlement rules read.
    case EventName.TransactionCompleted:
      await handleTransactionCompleted(eventData.data as unknown as PaddleTransaction, eventData.occurredAt, deps);
      break;
  }
}

// Records the subscription as its event describes it, then brings the customer in line (syncCustomer): their access
// follows all their subscriptions, and a subscription that ends ends its paid period. Changes nothing if a newer event
// for this subscription has already been applied (Paddle does not guarantee delivery order). Recording throws a
// foreign-key error if the customer has not been recorded yet, so the worker retries once customer.created arrives.
async function handleSubscription(data: SubscriptionEventData, occurredAt: string, deps: BillingDeps) {
  const { store } = deps;
  const applied = await store.recordSubscriptionEvent({
    subscriptionId: data.id,
    customerId: data.customerId,
    status: data.status,
    priceId: data.items[0]?.price?.id ?? '',
    productId: data.items[0]?.price?.productId ?? '',
    scheduledChangeAt: data.scheduledChange?.effectiveAt ?? null,
    scheduledChangeAction: data.scheduledChange?.action ?? null,
    currentPeriodEndsAt: data.currentBillingPeriod?.endsAt ?? null,
    endedAt: subscriptionEndedAt(data),
    occurredAt,
  });

  if (!applied) {
    console.info(`Paddle webhook: ignoring a ${data.status} event for ${data.id} older than the last one applied.`);
    return;
  }

  // A subscription to another product is recorded but entitles to nothing (entitlement-policy.ts: accessFor).
  if (data.items[0]?.price?.productId !== deps.config.paddle.proProductId) {
    console.warn(
      `Paddle webhook: subscription ${data.id} is not for the Tenantry Pro product (PADDLE_PRO_PRODUCT_ID); ` +
        'it entitles to nothing.',
    );
  }

  await syncCustomer(data.customerId, deps);
}

/**
 * A completed transaction: recorded in the payment ledger if it pays a billing period of a Pro subscription
 * (recordCompletedTransaction), then the customer is brought in line (syncCustomer). Throws a foreign-key error,
 * retried, if the customer is not recorded yet.
 */
async function handleTransactionCompleted(data: PaddleTransaction, occurredAt: string, deps: BillingDeps) {
  if (!(await recordCompletedTransaction(data, occurredAt, deps))) return;
  await syncCustomer(data.customerId!, deps);
}

/**
 * Records a completed transaction in the payment ledger if it pays a billing period of a Pro subscription (it has a
 * customer, a subscription, a billing period, and a recurring Pro price), whatever its origin, and returns whether it
 * does. Anything else (a one-time charge, another product) is ignored. Recording is idempotent on the transaction id.
 * The webhook records each transaction.completed this way, and reconcile any completed transaction Paddle lists that
 * the ledger is missing (reconcile-customer.ts).
 */
export async function recordCompletedTransaction(
  data: PaddleTransaction,
  occurredAt: string,
  deps: BillingDeps = defaultBillingDeps,
): Promise<boolean> {
  const proItem = data.items.find((item) => item.price?.productId === deps.config.paddle.proProductId);
  const price = proItem?.price;
  const totals = data.details?.totals;

  if (!data.customerId || !data.subscriptionId || !data.billingPeriod || !price?.billingCycle || !totals) {
    console.info(
      `Paddle: transaction ${data.id} (${data.origin}) pays no billing period of a Tenantry Pro subscription; ` +
        'not recorded.',
    );
    return false;
  }

  await deps.store.recordPayment({
    transactionId: data.id,
    customerId: data.customerId,
    subscriptionId: data.subscriptionId,
    origin: data.origin,
    priceId: price.id,
    billingInterval: price.billingCycle.interval,
    billingFrequency: price.billingCycle.frequency,
    periodStartsAt: data.billingPeriod.startsAt,
    periodEndsAt: data.billingPeriod.endsAt,
    subtotal: amount(totals.subtotal),
    discount: amount(totals.discount),
    total: amount(totals.total),
    currencyCode: totals.currencyCode,
    occurredAt,
  });

  return true;
}

// Paddle's amounts are strings of whole numbers in the currency's lowest unit.
function amount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Paddle amount ${JSON.stringify(value)} is not a whole number`);
  return parsed;
}

/**
 * Refunds, credits and chargebacks (Paddle adjustments). Each is recorded in the payment ledger, and the customer
 * brought in line (syncCustomer): what an adjustment does to a payment, and so to the qualifying run and any annual grant, is
 * decided there (entitlement-policy.ts). Paddle does not cancel a subscription whose payment is refunded, so an
 * approved full refund, or an approved chargeback, cancels it at once: the subscription.canceled event that follows
 * ends access as any cancellation does. A partial refund, and a chargeback warning (which can still be reversed),
 * change no access but tell the operator. Credits and reversals change no access. Throwing (Paddle unavailable)
 * makes the worker retry; recording the adjustment again changes nothing.
 */
async function handleAdjustment(data: AdjustmentEventData, occurredAt: string, deps: BillingDeps) {
  await deps.store.recordPaymentAdjustment({
    adjustmentId: data.id,
    transactionId: data.transactionId,
    customerId: data.customerId,
    subscriptionId: data.subscriptionId,
    action: data.action,
    type: data.type,
    itemTypes: data.items.map((item) => item.type),
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    occurredAt,
  });
  await syncCustomer(data.customerId, deps);

  const endsAccess =
    data.status === 'approved' && ((data.action === 'refund' && data.type === 'full') || data.action === 'chargeback');

  if (!endsAccess) {
    if (data.status === 'approved' && ['refund', 'chargeback_warning'].includes(data.action)) {
      await deps.alertOperator(
        `Paddle ${data.action.replace('_', ' ')} for customer ${data.customerId}`,
        `Adjustment ${data.id} (${data.type} ${data.action}) on transaction ${data.transactionId}` +
          `${data.subscriptionId ? `, subscription ${data.subscriptionId}` : ''}. Access is unchanged; ` +
          'cancel the subscription in Paddle if it should end.',
      );
    }
    return;
  }

  if (!data.subscriptionId) {
    await deps.alertOperator(
      `Paddle ${data.action} without a subscription for customer ${data.customerId}`,
      `Adjustment ${data.id} on transaction ${data.transactionId} names no subscription, so no access was changed.`,
    );
    return;
  }

  if (await deps.cancelSubscriptionNow(data.subscriptionId)) {
    await deps.alertOperator(
      `Subscription ${data.subscriptionId} cancelled after a ${data.action}`,
      `Adjustment ${data.id} (${data.type} ${data.action}) on transaction ${data.transactionId} for customer ` +
        `${data.customerId}. The subscription was cancelled immediately; its access ends when Paddle confirms.`,
    );
  }
}

// Records the customer's email unless a newer customer event has already been applied: the email decides
// which account owns the customer, so a delayed event must not restore an older one.
async function handleCustomer(eventData: CustomerCreatedEvent | CustomerUpdatedEvent, deps: BillingDeps) {
  const applied = await deps.store.recordCustomerEvent({
    customerId: eventData.data.id,
    // Stored normalised, as the database also enforces, so it matches the buyer's account in any case.
    email: normaliseEmail(eventData.data.email),
    occurredAt: eventData.occurredAt,
  });

  if (!applied) {
    console.info(`Paddle webhook: ignoring a customer event for ${eventData.data.id} older than the last one applied.`);
  }
}
