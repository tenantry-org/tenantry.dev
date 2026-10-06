import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';

/**
 * The parts of a Paddle subscription the subscriptions table records (billing/apply-paddle-event.ts:
 * recordSubscription). The SDK's Subscription entity, from the API, and its SubscriptionNotification, from a webhook,
 * both have these fields under these names.
 */
export interface PaddleSubscription {
  id: string;
  status: SubscriptionStatus;
  customerId: string;
  items: { price?: { id?: string | null; productId?: string | null } | null }[];
  currentBillingPeriod: { endsAt: string } | null;
  scheduledChange: { action?: string; effectiveAt?: string } | null;
  canceledAt: string | null;
  pausedAt: string | null;
  updatedAt: string;
}

/**
 * The subscription as Paddle holds it now. Reconcile records it, so a subscription notification that was lost or
 * failed is recovered (reconcile-customer.ts).
 */
export async function getSubscription(
  subscriptionId: string,
  paddle = getPaddleInstance(),
): Promise<PaddleSubscription> {
  return paddle.subscriptions.get(subscriptionId);
}
