import 'server-only';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';

/**
 * Cancels a subscription in Paddle at once (not at the end of the billing period). Paddle then sends
 * subscription.canceled, which ends access through the usual path (customer-access.ts). Returns false if the
 * subscription was already cancelled, so a repeated refund event does nothing.
 */
export async function cancelSubscriptionNow(subscriptionId: string, paddle = getPaddleInstance()): Promise<boolean> {
  const subscription = await paddle.subscriptions.get(subscriptionId);
  if (subscription.status === 'canceled') return false;

  await paddle.subscriptions.cancel(subscriptionId, { effectiveFrom: 'immediately' });
  return true;
}
