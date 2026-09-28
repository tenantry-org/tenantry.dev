import { Webhooks } from '@paddle/paddle-node-sdk';
import { ProcessWebhook } from '@/utils/paddle/process-webhook';
import { claimEvents, completeEvent, releaseWaitingEvents, retryEvent } from '@/utils/webhooks/inbox';
import { RECONCILE_CUSTOMER_EVENT, reconcileCustomer } from '@/utils/entitlements/reconcile-customer';

/** How long a claimed event stays locked: longer than processing one event can take. */
const LOCK_SECONDS = 120;
const BATCH_SIZE = 5;

export interface DrainResult {
  processed: number;
  retrying: number;
  failed: number;
}

/**
 * Processes due inbox events until none are left or the time budget is spent. Runs after each webhook
 * response and from the reconcile cron, so a failed event is retried even if no further notification
 * arrives. Several drains can run at once: the claim hands each customer's events to one of them, in order.
 * Besides Paddle's notifications the inbox holds reconcile jobs (reconcile.ts), which run in the same order.
 */
export async function drainInbox({
  budgetMs = 30_000,
  processor = new ProcessWebhook(),
  reconciler = reconcileCustomer,
  now = () => Date.now(),
}: {
  budgetMs?: number;
  processor?: Pick<ProcessWebhook, 'processEvent'>;
  reconciler?: (customerId: string) => Promise<unknown>;
  now?: () => number;
} = {}): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, retrying: 0, failed: 0 };
  const deadline = now() + budgetMs;

  while (now() < deadline) {
    const events = await claimEvents(BATCH_SIZE, LOCK_SECONDS);
    if (events.length === 0) break;

    for (const event of events) {
      try {
        if (event.eventType === RECONCILE_CUSTOMER_EVENT) {
          console.info(`Reconcile ${event.customerId}:`, JSON.stringify(await reconciler(event.customerId as string)));
        } else {
          await processor.processEvent(
            Webhooks.fromJson(event.payload as unknown as Parameters<typeof Webhooks.fromJson>[0]),
          );
        }
        await completeEvent(event.eventId);
        result.processed++;

        // Their subscription events may have been waiting for this customer to exist.
        if (event.eventType.startsWith('customer.') && event.customerId) {
          await releaseWaitingEvents(event.customerId);
        }
      } catch (error) {
        const outcome = await retryEvent(event, error);
        result[outcome]++;
        const log = outcome === 'failed' ? console.error : console.warn;
        log(
          `Inbox event ${event.eventId} (${event.eventType}) ${outcome === 'failed' ? 'failed for good' : 'will be retried'}:`,
          error,
        );
      }
    }
  }

  return result;
}
