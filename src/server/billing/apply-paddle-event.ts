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
import { isProProduct } from '@/constants/pro-product';
import { entitlementFor } from '@/server/billing/access-policy';
import { syncCustomerAccess } from '@/server/billing/customer-access';
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
}

/**
 * Applies one Paddle notification. Called by the inbox worker, one customer's events at a time and oldest first;
 * a subscription or customer event older than the last one applied to its subscription or customer changes
 * nothing. Throwing makes the worker retry the event later.
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
      await handleAdjustment(eventData.data as unknown as AdjustmentEventData, deps);
      break;
  }
}

// Records the subscription and its entitlement, then brings the customer's access (GitHub, licence,
// emails) in line with all their entitlements. Changes nothing if a newer event for this subscription
// has already been applied (Paddle does not guarantee delivery order).
// Recording the subscription throws a foreign-key error if the customer has not been recorded yet, so the
// worker retries once customer.created arrives.
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
    occurredAt,
  });

  if (!applied) {
    console.info(`Paddle webhook: ignoring a ${data.status} event for ${data.id} older than the last one applied.`);
    return;
  }

  // A subscription that is not (or is no longer) for Pro entitles to nothing: if it was for Pro before,
  // its entitlement ends, and the customer keeps access only through their other subscriptions.
  const previous = await store.getEntitlement(data.id);

  if (!isProProduct(data.items[0]?.price?.productId)) {
    console.warn(
      `Paddle webhook: subscription ${data.id} is not for the Tenantry Pro product (PADDLE_PRO_PRODUCT_ID); ` +
        'it entitles to nothing.',
    );
    if (previous && previous.status !== 'revoked') {
      await store.upsertEntitlement({ ...previous, status: 'revoked', graceStartedAt: null });
      await syncCustomerAccess(data.customerId, deps);
    }
    return;
  }

  // A past-due subscription is in grace from its first past-due event (access-policy.ts).
  const entitlement = entitlementFor(data.status, previous?.graceStartedAt ?? null, new Date(occurredAt));

  await store.upsertEntitlement({
    customerId: data.customerId,
    subscriptionId: data.id,
    status: entitlement.status,
    currentPeriodEndsAt: data.currentBillingPeriod?.endsAt ? new Date(data.currentBillingPeriod.endsAt) : null,
    graceStartedAt: entitlement.graceStartedAt,
  });

  await syncCustomerAccess(data.customerId, deps);
}

/**
 * Refunds and chargebacks (Paddle adjustments). Paddle does not cancel a subscription whose payment is
 * refunded, so an approved full refund, or an approved chargeback, cancels it at once: the
 * subscription.canceled event that follows ends access as any cancellation does. A partial refund, and a
 * chargeback warning (which can still be reversed), change nothing but tell the operator. Credits and
 * reversals are ignored. Throwing (Paddle unavailable) makes the worker retry.
 */
async function handleAdjustment(data: AdjustmentEventData, deps: BillingDeps) {
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
