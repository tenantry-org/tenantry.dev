import {
  CustomerCreatedEvent,
  CustomerUpdatedEvent,
  EventEntity,
  EventName,
  SubscriptionStatus,
} from '@paddle/paddle-node-sdk';
import { createClient } from '@/utils/supabase/server-internal';
import { resolveTier } from '@/constants/tier-mapping';
import { issueLicence } from '@/utils/licensing/licence-issuer';
import {
  EntitlementStatus,
  getCustomerEmail,
  getGithubLogin,
  recordLicence,
  revokeLicences,
  upsertEntitlement,
} from '@/utils/entitlements/entitlements-store';
import { grantAccess, revokeAccess } from '@/utils/github/provisioning';
import { sendEmail } from '@/utils/email/send';
import { accessRevokedEmail, welcomeProEmail } from '@/utils/email/templates';
import { provisioningAllowed } from '@/utils/provisioning-guard';
import { normaliseEmail } from '@/utils/customers/email';

// Fallback licence lifetime when Paddle doesn't supply a current billing period (the validator's
// own 30-day grace then covers any renewal gap; we re-issue on every subscription event).
const FALLBACK_LICENCE_DAYS = 30;

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
      case EventName.SubscriptionTrialing: {
        const data = eventData.data as unknown as SubscriptionEventData;
        if (!(await this.handleSubscription(data, eventData.occurredAt))) break;
        // Lifecycle emails fire once per transition (these events fire once and the inbox stores each
        // event once), so they don't spam on every subscription.updated.
        await this.sendLifecycleEmail(eventData.eventType, data.customerId);
        break;
      }
      case EventName.CustomerCreated:
      case EventName.CustomerUpdated:
        await this.updateCustomerData(eventData);
        break;
    }
  }

  private async sendLifecycleEmail(eventType: EventName, customerId: string) {
    const template =
      eventType === EventName.SubscriptionActivated
        ? welcomeProEmail
        : eventType === EventName.SubscriptionCanceled
          ? accessRevokedEmail
          : null;
    if (!template) return;

    const email = await getCustomerEmail(customerId);
    if (!email) {
      console.info(`Paddle webhook: no email on file for customer ${customerId}; skipping lifecycle email.`);
      return;
    }

    // Don't invite customers to "connect GitHub" when automated provisioning won't grant them access.
    if (template === welcomeProEmail && !provisioningAllowed(email)) return;

    await sendEmail(template(email)); // sendEmail never throws
  }

  // Records the subscription, then reconciles the customer's entitlement, licence, and GitHub access
  // to match the subscription's current status. Returns false, having changed nothing, if a newer event
  // for this subscription has already been applied (Paddle does not guarantee delivery order).
  private async handleSubscription(data: SubscriptionEventData, occurredAt: string): Promise<boolean> {
    if (!(await this.recordSubscriptionEvent(data, occurredAt))) {
      console.info(`Paddle webhook: ignoring a ${data.status} event for ${data.id} older than the last one applied.`);
      return false;
    }

    const tier = resolveTier(data.items[0]?.price?.productId);

    if (!tier) {
      console.warn(
        `Paddle webhook: subscription ${data.id} product is not mapped to a tier (see PADDLE_PRODUCT_TIER_MAP); ` +
          'skipping entitlement provisioning.',
      );
      return true;
    }

    const status = mapStatus(data.status);

    if (status === 'revoked') {
      await this.revokeEntitlement(data, tier);
      return true;
    }

    // Provisioning gate: in manual mode (PROVISIONING_MODE not 'auto') or for a non-allowlisted customer,
    // record the entitlement but withhold GitHub access + licence.
    const email = await getCustomerEmail(data.customerId);
    if (!provisioningAllowed(email)) {
      console.warn(
        `Paddle webhook: automated provisioning is off for ${email ?? data.customerId} ` +
          '(PROVISIONING_MODE/PROVISION_ALLOWLIST); recording entitlement but withholding GitHub access and licence.',
      );
      await upsertEntitlement({
        customerId: data.customerId,
        subscriptionId: data.id,
        tier,
        status,
        githubGranted: false,
      });
      return true;
    }

    await this.grantEntitlement(data, tier, status);
    return true;
  }

  private async grantEntitlement(data: SubscriptionEventData, tier: string, status: EntitlementStatus) {
    const githubLogin = await getGithubLogin(data.customerId);

    // Grant GitHub access if the customer has linked their account. Failures here (e.g. the GitHub App
    // not yet configured) are logged but must not fail the webhook — a reconciliation job can backfill.
    let githubGranted = false;

    if (githubLogin) {
      try {
        await grantAccess(githubLogin);
        githubGranted = true;
      } catch (error) {
        console.error(`Paddle webhook: failed to grant GitHub access to ${githubLogin}:`, error);
      }
    } else {
      console.info(
        `Paddle webhook: customer ${data.customerId} has not linked GitHub yet; entitlement recorded as pending access.`,
      );
    }

    await upsertEntitlement({
      customerId: data.customerId,
      subscriptionId: data.id,
      tier,
      status,
      githubGranted,
    });

    // Issue a fresh licence tracking the current billing period. Secret-dependent — log and continue.
    try {
      const expiresAt = licenceExpiry(data);
      const jwt = issueLicence({ customerId: data.customerId, tier, expiresAt });
      await recordLicence({ customerId: data.customerId, jwt, tier, expiresAt });
    } catch (error) {
      console.error(`Paddle webhook: failed to issue licence for customer ${data.customerId}:`, error);
    }
  }

  private async revokeEntitlement(data: SubscriptionEventData, tier: string) {
    const githubLogin = await getGithubLogin(data.customerId);

    if (githubLogin) {
      try {
        await revokeAccess(githubLogin);
      } catch (error) {
        console.error(`Paddle webhook: failed to revoke GitHub access for ${githubLogin}:`, error);
      }
    }

    await upsertEntitlement({
      customerId: data.customerId,
      subscriptionId: data.id,
      tier,
      status: 'revoked',
      githubGranted: false,
    });

    try {
      await revokeLicences(data.customerId);
    } catch (error) {
      console.error(`Paddle webhook: failed to revoke licences for customer ${data.customerId}:`, error);
    }
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

function licenceExpiry(data: SubscriptionEventData): Date {
  if (data.currentBillingPeriod?.endsAt) {
    return new Date(data.currentBillingPeriod.endsAt);
  }

  return new Date(Date.now() + FALLBACK_LICENCE_DAYS * 24 * 60 * 60 * 1000);
}
