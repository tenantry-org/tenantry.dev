import { Webhooks } from '@paddle/paddle-node-sdk';
import { ProcessWebhook } from '@/utils/paddle/process-webhook';
import { claimEvents, completeEvent, type InboxEvent, releaseWaitingEvents, retryEvent } from '@/utils/webhooks/inbox';
import { RECONCILE_CUSTOMER_EVENT, reconcileCustomer } from '@/utils/entitlements/reconcile-customer';
import { CUSTOMER_LEASE_EVENT } from '@/utils/webhooks/customer-lease';
import { alertOperator } from '@/utils/email/alerts';
import { errorMessage } from '@/utils/errors';

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
 * Besides Paddle's notifications the inbox holds reconcile jobs (reconcile.ts), which run in the same order,
 * and customer leases (customer-lease.ts), which hold a customer's events back while account linking runs.
 */
interface Handlers {
  processor: Pick<ProcessWebhook, 'processEvent'>;
  reconciler: (customerId: string) => Promise<unknown>;
}

export async function drainInbox({
  budgetMs = 30_000,
  processor = new ProcessWebhook(),
  reconciler = reconcileCustomer,
  now = () => Date.now(),
}: Partial<Handlers> & { budgetMs?: number; now?: () => number } = {}): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, retrying: 0, failed: 0 };
  const deadline = now() + budgetMs;

  while (now() < deadline) {
    const events = await claimEvents(BATCH_SIZE, LOCK_SECONDS);
    if (events.length === 0) break;

    for (const event of events) {
      result[await handleEvent(event, { processor, reconciler })]++;
    }
  }

  return result;
}

// Processes one claimed event and completes it, or schedules a retry if it fails; gives up after the last
// attempt and alerts the operator.
async function handleEvent(event: InboxEvent, handlers: Handlers): Promise<keyof DrainResult> {
  try {
    await runEvent(event, handlers);
    await completeEvent(event.eventId);

    // Their subscription events may have been waiting for this customer to exist.
    if (event.eventType.startsWith('customer.') && event.customerId) {
      await releaseWaitingEvents(event.customerId);
    }

    return 'processed';
  } catch (error) {
    const outcome = await retryEvent(event, error);
    const log = outcome === 'failed' ? console.error : console.warn;
    const fate = outcome === 'failed' ? 'failed for good' : 'will be retried';
    log(`Inbox event ${event.eventId} (${event.eventType}) ${fate}:`, error);

    if (outcome === 'failed') {
      await alertOperator(
        `Inbox event ${event.eventId} failed for good`,
        `Inbox event ${event.eventId} (${event.eventType}, customer ${event.customerId ?? 'unknown'}) failed on ` +
          `every attempt and will not be retried: ${errorMessage(error)}. Its effect is missing until someone ` +
          'handles it; the next reconcile corrects what it can for this customer.',
      );
    }

    return outcome;
  }
}

async function runEvent(event: InboxEvent, { processor, reconciler }: Handlers) {
  // A lease whose holder died without releasing it (customer-lease.ts): claimed once it expired; nothing to do.
  if (event.eventType === CUSTOMER_LEASE_EVENT) return;

  if (event.eventType === RECONCILE_CUSTOMER_EVENT) {
    console.info(`Reconcile ${event.customerId}:`, JSON.stringify(await reconciler(event.customerId as string)));
    return;
  }

  await processor.processEvent(Webhooks.fromJson(event.payload as unknown as Parameters<typeof Webhooks.fromJson>[0]));
}
