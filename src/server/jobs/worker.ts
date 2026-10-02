import 'server-only';
import { EventEntity, Webhooks } from '@paddle/paddle-node-sdk';
import { claimJobs, completeJob, type Job, releaseWaitingJobs, retryJob } from '@/server/db/customer-jobs';
import { alertOperator } from '@/server/integrations/email/alerts';
import { errorMessage } from '@/lib/errors';

/**
 * How long a claimed job stays locked: longer than running one job can take, since every route that runs jobs stops
 * at its `maxDuration`, which is shorter (lease-deadlines.test.ts).
 */
export const LOCK_SECONDS = 120;
const BATCH_SIZE = 5;

export interface DrainResult {
  processed: number;
  retrying: number;
  failed: number;
}

/**
 * What the jobs do, given by the billing services (process-jobs.ts): apply a Paddle notification, and reconcile one
 * customer. Throwing makes the worker retry the job later.
 */
export interface JobHandlers {
  applyPaddleEvent: (event: EventEntity) => Promise<void>;
  reconcileCustomer: (customerId: string) => Promise<unknown>;
}

/**
 * Runs due customer jobs (db/customer-jobs.ts) until none are left or the time budget is spent. Runs after each
 * webhook response and from the reconcile cron, so a failed job is retried even if no further notification arrives.
 * Several drains can run at once: the claim hands each customer's jobs to one of them, in order.
 */
export async function drainJobs(
  handlers: JobHandlers,
  { budgetMs = 30_000, now = () => Date.now() }: { budgetMs?: number; now?: () => number } = {},
): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, retrying: 0, failed: 0 };
  const deadline = now() + budgetMs;

  while (now() < deadline) {
    const jobs = await claimJobs(BATCH_SIZE, LOCK_SECONDS);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      result[await handleJob(job, handlers)]++;
    }
  }

  return result;
}

// Runs one claimed job and completes it, or schedules a retry if it fails; gives up after the last attempt and
// alerts the operator.
async function handleJob(job: Job, handlers: JobHandlers): Promise<keyof DrainResult> {
  try {
    await runJob(job, handlers);
    await completeJob(job.id);

    // Their subscription events may have been waiting for this customer to exist.
    if (job.kind === 'paddle_event' && job.event.event_type.startsWith('customer.') && job.customerId) {
      await releaseWaitingJobs(job.customerId);
    }

    return 'processed';
  } catch (error) {
    const outcome = await retryJob(job, error);
    const log = outcome === 'failed' ? console.error : console.warn;
    const fate = outcome === 'failed' ? 'failed for good' : 'will be retried';
    log(`Job ${job.id} (${describe(job)}) ${fate}:`, error);

    if (outcome === 'failed') {
      await alertOperator(
        `Job ${job.id} failed for good`,
        `Job ${job.id} (${describe(job)}, customer ${job.customerId ?? 'none'}) failed on every attempt and will ` +
          `not be retried: ${errorMessage(error)}. Its effect is missing until someone handles it; the next ` +
          'reconcile corrects what it can for this customer.',
      );
    }

    return outcome;
  }
}

async function runJob(job: Job, handlers: JobHandlers): Promise<void> {
  switch (job.kind) {
    case 'paddle_event':
      await handlers.applyPaddleEvent(
        Webhooks.fromJson(job.event as unknown as Parameters<typeof Webhooks.fromJson>[0]),
      );
      return;
    case 'reconcile':
      console.info(`Reconcile ${job.customerId}:`, JSON.stringify(await handlers.reconcileCustomer(job.customerId)));
      return;
    case 'lease':
      // A lease whose holder died without releasing it (customer-lease.ts), claimed once it expired: nothing to do.
      return;
    default:
      return unknownKind(job);
  }
}

function describe(job: Job): string {
  return job.kind === 'paddle_event' ? `Paddle event ${job.event.event_type}` : job.kind;
}

// A new kind of job fails to compile here until runJob handles it.
function unknownKind(job: never): never {
  throw new Error(`Unknown job: ${JSON.stringify(job)}`);
}
