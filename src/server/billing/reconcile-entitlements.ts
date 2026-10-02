import 'server-only';
import { customersToReconcile } from '@/server/db/billing-store';
import { enqueueReconcileJobs } from '@/server/db/inbox';
import type { DrainResult } from '@/server/jobs/worker';
import { processInbox } from '@/server/billing/process-inbox';

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

/** What the reconcile run uses: who to reconcile (the billing store), and the inbox. */
export interface ReconcileDeps {
  customersToReconcile: () => Promise<string[]>;
  enqueueReconcileJobs: (customerIds: string[], now: Date) => Promise<void>;
  processInbox: (options: { budgetMs?: number }) => Promise<DrainResult>;
}

const defaultReconcileDeps: ReconcileDeps = { customersToReconcile, enqueueReconcileJobs, processInbox };

export async function reconcileEntitlements(
  { now = new Date(), budgetMs }: { now?: Date; budgetMs?: number } = {},
  deps: ReconcileDeps = defaultReconcileDeps,
): Promise<ReconcileResult> {
  const customerIds = await deps.customersToReconcile();
  await deps.enqueueReconcileJobs(customerIds, now);

  return { customers: customerIds.length, inbox: await deps.processInbox({ budgetMs }) };
}
