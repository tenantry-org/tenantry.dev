import 'server-only';
import { EventEntity, Webhooks } from '@paddle/paddle-node-sdk';
import { claimJobs, completeJob, type Job, releaseWaitingJobs, retryJob } from '@/server/db/customer-jobs';
import { alertOperator } from '@/server/integrations/email/alerts';
import { errorMessage } from '@/lib/errors';

/**
 * How long a claimed job stays locked: longer than running one job can take, since every route that runs jobs stops
 * at its `maxDuration`, which is shorter (claim-deadlines.test.ts).
 */
export const LOCK_SECONDS = 120;

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
 * Runs due customer jobs (db/customer-jobs.ts) until none are left or the `deadline` (a time in milliseconds, by
 * default 30 seconds from the start of the drain) has passed. Runs after each webhook response and from the reconcile
 * cron, so a failed job is retried even if no further notification arrives. Several drains can run at once: the claim
 * hands each customer's jobs to one of them, in order. It claims one job at a time, so it starts no job after the
 * deadline, and every job it claims it runs.
 */
export async function drainJobs(
  handlers: JobHandlers,
  { deadline, now = () => Date.now() }: { deadline?: number; now?: () => number } = {},
): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, retrying: 0, failed: 0 };
  const end = deadline ?? now() + 30_000;

  while (now() < end) {
    const [job] = await claimJobs(1, LOCK_SECONDS);
    if (!job) break;

    result[await handleJob(job, handlers)]++;
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
          `not be retried: ${errorMessage(error)}. Its effect is missing until someone handles it. Reconcile ` +
          'visits a customer only while they have access, a running subscription, paid time being served, a ' +
          'licence failure or a recorded refund, credit or chargeback still to act on. A visit recomputes the ' +
          "customer's access and entitlement from what is recorded, records a completed Pro payment, refund, " +
          'credit or chargeback Paddle lists that is missing, acts as the webhook would on any recorded refund, ' +
          'credit or chargeback not yet acted on, and records the current status of each Pro subscription recorded ' +
          'as active, trialing or past due. It does not recover a lost customer event, an event for a subscription ' +
          'recorded with another status or not recorded at all, or anything for a customer it does not visit: for ' +
          'those, replay the notification from Paddle.',
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
