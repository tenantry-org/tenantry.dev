import {
  CustomerCreatedEvent,
  CustomerUpdatedEvent,
  EventEntity,
  EventName,
  SubscriptionStatus,
} from '@paddle/paddle-node-sdk';
import { createClient } from '@/utils/supabase/server-internal';
import { resolveTier } from '@/constants/tier-mapping';
import { EntitlementStatus, upsertEntitlement } from '@/utils/entitlements/entitlements-store';
import { syncCustomerAccess } from '@/utils/entitlements/customer-access';
import { normaliseEmail } from '@/utils/customers/email';

// Structural view of the bits of SubscriptionNotification this handler needs.
interface SubscriptionEventData {
  id: string;
  status: SubscriptionStatus;
  customerId: string;
  items: { price?: { id?: string | null; productId?: string | null } | null }[];
  currentBillingPeriod: { endsAt: string } | null;
  scheduledChange: { effectiveAt?: string } | null;
}

export class ProcessWebhook {
  /**
   * Applies one notification. Called by the inbox worker, one customer's events at a time and oldest
   * first; a subscription event older than the last one applied to its subscription changes nothing.
   * Throwing makes the worker retry the event later.
   */
  async processEvent(eventData: EventEntity) {
    switch (eventData.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionTrialing:
        await this.handleSubscription(eventData.data as unknown as SubscriptionEventData, eventData.occurredAt);
        break;
      case EventName.CustomerCreated:
      case EventName.CustomerUpdated:
        await this.updateCustomerData(eventData);
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

    const tier = resolveTier(data.items[0]?.price?.productId);

    if (!tier) {
      console.warn(
        `Paddle webhook: subscription ${data.id} product is not mapped to a tier (see PADDLE_PRODUCT_TIER_MAP); ` +
          'skipping entitlement provisioning.',
      );
      return;
    }

    await upsertEntitlement({
      customerId: data.customerId,
      subscriptionId: data.id,
      tier,
      status: mapStatus(data.status),
      currentPeriodEndsAt: data.currentBillingPeriod?.endsAt ? new Date(data.currentBillingPeriod.endsAt) : null,
    });

    await syncCustomerAccess(data.customerId);
  }

  // Returns false if a newer event for this subscription has already been applied. Throws a foreign-key
  // error if the customer has not been recorded yet, so the worker retries once customer.created arrives.
  private async recordSubscriptionEvent(data: SubscriptionEventData, occurredAt: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: applied, error } = await supabase.rpc('record_subscription_event', {
      p_subscription_id: data.id,
      p_customer_id: data.customerId,
      p_status: data.status,
      p_price_id: data.items[0]?.price?.id ?? '',
      p_product_id: data.items[0]?.price?.productId ?? '',
      p_scheduled_change: data.scheduledChange?.effectiveAt ?? null,
      p_occurred_at: occurredAt,
    });

    if (error) throw error;

    return applied === true;
  }

  private async updateCustomerData(eventData: CustomerCreatedEvent | CustomerUpdatedEvent) {
    const supabase = await createClient();
    const { error } = await supabase
      .from('customers')
      .upsert({
        customer_id: eventData.data.id,
        // Stored normalised, as the database also enforces, so it matches the buyer's account in any case.
        email: normaliseEmail(eventData.data.email),
      })
      .select();

    if (error) throw error;
  }
}

// active/trialing keep full access; past_due is a dunning state we treat as grace (access continues,
// the runtime grace period covers it); paused/canceled revoke.
function mapStatus(status: SubscriptionStatus): EntitlementStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'grace';
    case 'paused':
    case 'canceled':
    default:
      return 'revoked';
  }
}
