import 'server-only';
import { customersToReconcile } from '@/utils/entitlements/entitlements-store';
import { enqueueReconcileJobs } from '@/utils/webhooks/inbox';
import { DrainResult, drainInbox } from '@/utils/webhooks/worker';

/**
 * The reconcile run (the daily cron, /api/reconcile): queues a reconcile job in the webhook inbox for every
 * customer who is entitled, has a GitHub link or has a live licence, then drains the inbox. The worker runs
 * each job (reconcile-customer.ts) in order with that customer's Paddle events and never alongside one, so
 * reconciling cannot race a webhook: a job sees the customer's entitlements as the events before it left
 * them. Jobs the drain does not reach, or that fail and back off, are picked up by later drains.
 */
export interface ReconcileResult {
  customers: number;
  inbox: DrainResult;
}

export async function reconcileEntitlements({
  now = new Date(),
  budgetMs,
}: { now?: Date; budgetMs?: number } = {}): Promise<ReconcileResult> {
  const customerIds = await customersToReconcile();
  await enqueueReconcileJobs(customerIds, now);

  return { customers: customerIds.length, inbox: await drainInbox({ budgetMs }) };
}
