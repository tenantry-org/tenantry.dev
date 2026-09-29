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
import { createClient } from '@/utils/supabase/server-internal';
import { isProProduct } from '@/constants/pro-product';
import { getEntitlement, upsertEntitlement } from '@/utils/entitlements/entitlements-store';
import { entitlementFor } from '@/utils/entitlements/grace';
import { syncCustomerAccess } from '@/utils/entitlements/customer-access';
import { normaliseEmail } from '@/utils/customers/email';
import { cancelSubscriptionNow } from '@/utils/paddle/cancel-subscription';
import { alertOperator } from '@/utils/email/alerts';

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

export class ProcessWebhook {
  /**
   * Applies one notification. Called by the inbox worker, one customer's events at a time and oldest
   * first; a subscription or customer event older than the last one applied to its subscription or customer
   * changes nothing.
   * Throwing makes the worker retry the event later.
   */
  async processEvent(eventData: EventEntity) {
    switch (eventData.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionTrialing:
        await this.handleSubscription(eventData.data as unknown as SubscriptionEventData, eventData.occurredAt);
        break;
      case EventName.CustomerCreated:
      case EventName.CustomerUpdated:
        await this.recordCustomerEvent(eventData);
        break;
      case EventName.AdjustmentCreated:
      case EventName.AdjustmentUpdated:
        await this.handleAdjustment(eventData.data as unknown as AdjustmentEventData);
        break;
    }
  }

  // Records the subscription and its entitlement, then brings the customer's access (GitHub, licence,
  // emails) in line with all their entitlements. Changes nothing if a newer event for this subscription
  // has already been applied (Paddle does not guarantee delivery order).
  private async handleSubscription(data: SubscriptionEventData, occurredAt: string) {
    if (!(await this.recordSubscriptionEvent(data, occurredAt))) {
      console.info(`Paddle webhook: ignoring a ${data.status} event for ${data.id} older than the last one applied.`);
      return;
    }

    // A subscription that is not (or is no longer) for Pro entitles to nothing: if it was for Pro before,
    // its entitlement ends, and the customer keeps access only through their other subscriptions.
    const previous = await getEntitlement(data.id);

    if (!isProProduct(data.items[0]?.price?.productId)) {
      console.warn(
        `Paddle webhook: subscription ${data.id} is not for the Tenantry Pro product (PADDLE_PRO_PRODUCT_ID); ` +
          'it entitles to nothing.',
      );
      if (previous && previous.status !== 'revoked') {
        await upsertEntitlement({ ...previous, status: 'revoked', graceStartedAt: null });
        await syncCustomerAccess(data.customerId);
      }
      return;
    }

    // A past-due subscription is in grace from its first past-due event (grace.ts).
    const entitlement = entitlementFor(data.status, previous?.graceStartedAt ?? null, new Date(occurredAt));

    await upsertEntitlement({
      customerId: data.customerId,
      subscriptionId: data.id,
      status: entitlement.status,
      currentPeriodEndsAt: data.currentBillingPeriod?.endsAt ? new Date(data.currentBillingPeriod.endsAt) : null,
      graceStartedAt: entitlement.graceStartedAt,
    });

    await syncCustomerAccess(data.customerId);
  }

  /**
   * Refunds and chargebacks (Paddle adjustments). Paddle does not cancel a subscription whose payment is
   * refunded, so an approved full refund, or an approved chargeback, cancels it at once: the
   * subscription.canceled event that follows ends access as any cancellation does. A partial refund, and a
   * chargeback warning (which can still be reversed), change nothing but tell the operator. Credits and
   * reversals are ignored. Throwing (Paddle unavailable) makes the worker retry.
   */
  private async handleAdjustment(data: AdjustmentEventData) {
    const endsAccess =
      data.status === 'approved' &&
      ((data.action === 'refund' && data.type === 'full') || data.action === 'chargeback');

    if (!endsAccess) {
      if (data.status === 'approved' && ['refund', 'chargeback_warning'].includes(data.action)) {
        await alertOperator(
          `Paddle ${data.action.replace('_', ' ')} for customer ${data.customerId}`,
          `Adjustment ${data.id} (${data.type} ${data.action}) on transaction ${data.transactionId}` +
            `${data.subscriptionId ? `, subscription ${data.subscriptionId}` : ''}. Access is unchanged; ` +
            'cancel the subscription in Paddle if it should end.',
        );
      }
      return;
    }

    if (!data.subscriptionId) {
      await alertOperator(
        `Paddle ${data.action} without a subscription for customer ${data.customerId}`,
        `Adjustment ${data.id} on transaction ${data.transactionId} names no subscription, so no access was changed.`,
      );
      return;
    }

    if (await cancelSubscriptionNow(data.subscriptionId)) {
      await alertOperator(
        `Subscription ${data.subscriptionId} cancelled after a ${data.action}`,
        `Adjustment ${data.id} (${data.type} ${data.action}) on transaction ${data.transactionId} for customer ` +
          `${data.customerId}. The subscription was cancelled immediately; its access ends when Paddle confirms.`,
      );
    }
  }

  // Returns false if a newer event for this subscription has already been applied. Throws a foreign-key
  // error if the customer has not been recorded yet, so the worker retries once customer.created arrives.
  private async recordSubscriptionEvent(data: SubscriptionEventData, occurredAt: string): Promise<boolean> {
    const supabase = createClient();
    const { data: applied, error } = await supabase.rpc('record_subscription_event', {
      p_subscription_id: data.id,
      p_customer_id: data.customerId,
      p_status: data.status,
      p_price_id: data.items[0]?.price?.id ?? '',
      p_product_id: data.items[0]?.price?.productId ?? '',
      p_scheduled_change: data.scheduledChange?.effectiveAt ?? null,
      p_scheduled_change_action: data.scheduledChange?.action ?? null,
      p_occurred_at: occurredAt,
    });

    if (error) throw error;

    return applied === true;
  }

  // Records the customer's email unless a newer customer event has already been applied: the email decides
  // which account owns the customer, so a delayed event must not restore an older one.
  private async recordCustomerEvent(eventData: CustomerCreatedEvent | CustomerUpdatedEvent) {
    const supabase = createClient();
    const { data: applied, error } = await supabase.rpc('record_customer_event', {
      p_customer_id: eventData.data.id,
      // Stored normalised, as the database also enforces, so it matches the buyer's account in any case.
      p_email: normaliseEmail(eventData.data.email),
      p_occurred_at: eventData.occurredAt,
    });

    if (error) throw error;

    if (applied !== true) {
      console.info(
        `Paddle webhook: ignoring a customer event for ${eventData.data.id} older than the last one applied.`,
      );
    }
  }
}
