import 'server-only';
import { customersToReconcile } from '@/server/db/billing-store';
import { enqueueReconcileJobs } from '@/server/db/customer-jobs';
import type { DrainResult } from '@/server/jobs/worker';
import { processJobs } from '@/server/billing/process-jobs';

/**
 * The reconcile run (the daily cron, /api/reconcile): queues a reconcile job for every customer whose state may need
 * correcting (customers_to_reconcile), then runs the due jobs. The worker runs each reconcile (reconcile-customer.ts)
 * in order with that customer's Paddle events and never alongside one, so reconciling cannot race a webhook: it sees
 * the customer's entitlements as the events before it left them. Jobs the run does not reach, or that fail and back
 * off, are picked up by later runs and webhooks.
 */
export interface ReconcileResult {
  customers: number;
  jobs: DrainResult;
}

/** What the reconcile run uses: who to reconcile (the billing store), and the customer jobs. */
export interface ReconcileDeps {
  customersToReconcile: () => Promise<string[]>;
  enqueueReconcileJobs: (customerIds: string[], at: Date) => Promise<void>;
  processJobs: (options: { budgetMs?: number }) => Promise<DrainResult>;
}

const defaultReconcileDeps: ReconcileDeps = { customersToReconcile, enqueueReconcileJobs, processJobs };

export async function reconcileEntitlements(
  { now = new Date(), budgetMs }: { now?: Date; budgetMs?: number } = {},
  deps: ReconcileDeps = defaultReconcileDeps,
): Promise<ReconcileResult> {
  const customerIds = await deps.customersToReconcile();
  await deps.enqueueReconcileJobs(customerIds, now);

  return { customers: customerIds.length, jobs: await deps.processJobs({ budgetMs }) };
}
