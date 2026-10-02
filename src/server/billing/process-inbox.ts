import 'server-only';
import { DrainResult, drainInbox } from '@/server/jobs/worker';
import { applyPaddleEvent } from '@/server/billing/apply-paddle-event';
import { reconcileCustomer } from '@/server/billing/reconcile-customer';

/**
 * Drains the webhook inbox (jobs/worker.ts), applying Paddle's notifications and running reconcile jobs, until
 * none is due or `budgetMs` is spent. The webhook runs it after each response, and the reconcile run after queuing
 * its jobs.
 */
export function processInbox({ budgetMs }: { budgetMs?: number } = {}): Promise<DrainResult> {
  return drainInbox({ applyPaddleEvent, reconcileCustomer }, { budgetMs });
}
