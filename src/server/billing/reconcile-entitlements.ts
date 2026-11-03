import 'server-only';
import { customersToReconcile } from '@/server/db/billing-store';
import { deleteDoneJobsBefore, enqueueReconcileJobs } from '@/server/db/customer-jobs';
import { deleteFeedDownloadsBefore } from '@/server/db/package-feed';
import type { DrainResult } from '@/server/jobs/worker';
import { processJobs } from '@/server/billing/process-jobs';
import { alertOperator } from '@/server/integrations/email/alerts';
import { errorMessage } from '@/lib/errors';

/**
 * The reconcile run (the daily cron, /api/reconcile): deletes the package feed's download records older than
 * FEED_DOWNLOAD_RETENTION_DAYS and the customer jobs done more than DONE_JOB_RETENTION_DAYS ago, queues a reconcile job
 * for every customer whose state may need correcting (customers_to_reconcile), then runs the due jobs until `budgetMs`
 * from the start of the run has passed. The deletions come first, so a run stopped at its time limit has still done
 * them; a deletion that fails is logged and alerted on, and the run goes on. The worker runs each reconcile
 * (reconcile-customer.ts) in order with that customer's Paddle events and never alongside one, so reconciling cannot
 * race a webhook: it sees the customer's entitlements as the events before it left them. Jobs the run does not reach,
 * or that fail and back off, are picked up by later runs and webhooks.
 */
export interface ReconcileResult {
  customers: number;
  jobs: DrainResult;
  /** Null if the deletion failed. */
  feedDownloadsDeleted: number | null;
  /** Null if the deletion failed. */
  doneJobsDeleted: number | null;
}

/** How long the package feed's download records are kept: the period the privacy policy states. */
export const FEED_DOWNLOAD_RETENTION_DAYS = 90;
/**
 * How long a customer job is kept once done: the period the privacy policy states for Paddle's notifications. Paddle
 * retries a delivery for about three days, so a retry still finds its job and is not run twice.
 */
export const DONE_JOB_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the reconcile run uses: who to reconcile (the billing store), the customer jobs, the download records, and the
 * operator alert.
 */
export interface ReconcileDeps {
  customersToReconcile: () => Promise<string[]>;
  enqueueReconcileJobs: (customerIds: string[], at: Date) => Promise<void>;
  processJobs: (options: { deadline?: number }) => Promise<DrainResult>;
  deleteFeedDownloadsBefore: (cutoff: Date) => Promise<number>;
  deleteDoneJobsBefore: (cutoff: Date) => Promise<number>;
  alertOperator: (subject: string, detail: string) => Promise<void>;
}

const defaultReconcileDeps: ReconcileDeps = {
  customersToReconcile,
  enqueueReconcileJobs,
  processJobs,
  deleteFeedDownloadsBefore,
  deleteDoneJobsBefore,
  alertOperator,
};

export async function reconcileEntitlements(
  { now = new Date(), budgetMs }: { now?: Date; budgetMs?: number } = {},
  deps: ReconcileDeps = defaultReconcileDeps,
): Promise<ReconcileResult> {
  const feedDownloadsDeleted = await deleteOld(
    {
      subject: 'Old feed download records were not deleted',
      what: `the package feed's download records older than ${FEED_DOWNLOAD_RETENTION_DAYS} days`,
      table: 'feed_downloads',
      days: FEED_DOWNLOAD_RETENTION_DAYS,
      deleteBefore: deps.deleteFeedDownloadsBefore,
    },
    now,
    deps,
  );
  const doneJobsDeleted = await deleteOld(
    {
      subject: 'Old customer jobs were not deleted',
      what: `the customer jobs done more than ${DONE_JOB_RETENTION_DAYS} days ago`,
      table: 'customer_jobs',
      days: DONE_JOB_RETENTION_DAYS,
      deleteBefore: deps.deleteDoneJobsBefore,
    },
    now,
    deps,
  );

  const customerIds = await deps.customersToReconcile();
  await deps.enqueueReconcileJobs(customerIds, now);
  const jobs = await deps.processJobs({ deadline: budgetMs === undefined ? undefined : now.getTime() + budgetMs });

  return { customers: customerIds.length, jobs, feedDownloadsDeleted, doneJobsDeleted };
}

interface Retention {
  /** The alert's subject when the deletion fails. */
  subject: string;
  /** The rows, with their age, for the log and the alert. */
  what: string;
  table: string;
  days: number;
  deleteBefore: (cutoff: Date) => Promise<number>;
}

// Deletes the rows older than their retention period and returns how many. A failure is logged and alerted on, and
// returns null, so the rest of the run goes ahead; the next run deletes them.
async function deleteOld(
  { subject, what, table, days, deleteBefore }: Retention,
  now: Date,
  deps: ReconcileDeps,
): Promise<number | null> {
  try {
    return await deleteBefore(new Date(now.getTime() - days * DAY_MS));
  } catch (error) {
    console.error(`Reconcile: deleting ${what} failed:`, error);
    await deps.alertOperator(
      subject,
      `Deleting ${what} failed: ${errorMessage(error)}. The privacy policy says they are kept for ${days} days. The ` +
        `reconcile jobs run as usual, and the next run tries the deletion again; check ${table} if it fails again.`,
    );
    return null;
  }
}
