import 'server-only';
import { DrainResult, drainJobs } from '@/server/jobs/worker';
import { applyPaddleEvent } from '@/server/billing/apply-paddle-event';
import { reconcileCustomer } from '@/server/billing/reconcile-customer';

/**
 * Runs the due customer jobs (jobs/worker.ts), applying Paddle's notifications and reconciling customers, until none
 * is due or `budgetMs` is spent. The webhook runs it after each response, and the reconcile run after queuing its jobs.
 */
export function processJobs({ budgetMs }: { budgetMs?: number } = {}): Promise<DrainResult> {
  return drainJobs({ applyPaddleEvent, reconcileCustomer }, { budgetMs });
}
