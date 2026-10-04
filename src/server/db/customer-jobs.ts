import 'server-only';
import { createServiceRoleClient } from '@/server/db/service-role-client';
import type { Json, Tables } from '@/lib/supabase/database.types';
import { errorMessage } from '@/lib/errors';

/**
 * The customer jobs (`customer_jobs`, supabase/migrations/20261002120000_baseline.sql): the work that changes a
 * customer's access, which the worker (jobs/worker.ts) runs one customer at a time, in order. A job is a verified
 * Paddle notification or a reconcile of one customer.
 */

/**
 * A Paddle notification as delivered: the verified JSON body, in Paddle's snake_case. A type rather than an
 * interface, so that it is assignable to the payload column's Json.
 */
export type PaddleEventJson = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: { [key: string]: Json | undefined };
};

/** A claimed job. `attempts` counts this one. */
export type Job = { id: string; attempts: number } & (
  | { kind: 'paddle_event'; customerId: string | null; event: PaddleEventJson }
  | { kind: 'reconcile'; customerId: string }
);

/** Attempts before a job is marked failed. With the backoff below they span about 8 hours. */
export const MAX_ATTEMPTS = 12;

/** Minutes to wait before the next attempt: doubling from one minute, capped at an hour. */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), 60);
}

/** The customer a Paddle event concerns, whose turn it takes, or null if it concerns none. */
export function eventCustomerId(event: PaddleEventJson): string | null {
  const data = event.data ?? {};
  const id = event.event_type.startsWith('customer.') ? data.id : data.customer_id;

  return typeof id === 'string' && id ? id : null;
}

/**
 * Stores a verified Paddle event as a job. Returns false if it was already stored: its id is Paddle's event id, so
 * a duplicate delivery, even a concurrent one, is a no-op (`INSERT … ON CONFLICT DO NOTHING`).
 */
export async function enqueuePaddleEvent(event: PaddleEventJson): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('customer_jobs')
    .upsert(
      {
        id: event.event_id,
        kind: 'paddle_event',
        customer_id: eventCustomerId(event),
        occurred_at: event.occurred_at,
        event_type: event.event_type,
        payload: event,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw error;

  return (data ?? []).length > 0;
}

/**
 * Queues a reconcile job for each customer, as of `at`: it runs after their jobs that occurred before. The job's id
 * includes `at`, so queueing the same customers again for the same `at` adds nothing.
 */
export async function enqueueReconcileJobs(customerIds: string[], at: Date): Promise<void> {
  if (customerIds.length === 0) return;

  const occurredAt = at.toISOString();
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('customer_jobs').upsert(
    customerIds.map((customerId) => ({
      id: `reconcile_${customerId}_${occurredAt}`,
      kind: 'reconcile',
      customer_id: customerId,
      occurred_at: occurredAt,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  );

  if (error) throw error;
}

/** Claims up to `limit` due jobs, at most one per customer, locking them for `lockSeconds`. */
export async function claimJobs(limit: number, lockSeconds: number): Promise<Job[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('claim_customer_jobs', { p_limit: limit, p_lock_seconds: lockSeconds });

  if (error) throw error;

  return (data ?? []).map(toJob);
}

// customer_jobs_shape_check guarantees what each kind has: a Paddle event its body, a reconcile job a customer.
function toJob(row: Tables<'customer_jobs'>): Job {
  const { id, attempts } = row;

  switch (row.kind) {
    case 'paddle_event':
      return { id, attempts, kind: 'paddle_event', customerId: row.customer_id, event: row.payload as PaddleEventJson };
    case 'reconcile':
      return { id, attempts, kind: 'reconcile', customerId: row.customer_id as string };
    default:
      throw new Error(`Job ${id} is of an unknown kind: ${row.kind}`);
  }
}

export async function completeJob(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('customer_jobs')
    .update({ status: 'done', processed_at: new Date().toISOString(), locked_until: null, last_error: null })
    .eq('id', id);

  if (error) throw error;
}

/** Schedules another attempt with backoff, or marks the job failed after MAX_ATTEMPTS. */
export async function retryJob(job: Job, failure: unknown, now: Date = new Date()): Promise<'retrying' | 'failed'> {
  const supabase = createServiceRoleClient();
  const giveUp = job.attempts >= MAX_ATTEMPTS;
  const nextAttemptAt = new Date(now.getTime() + retryDelayMinutes(job.attempts) * 60_000);

  const { error } = await supabase
    .from('customer_jobs')
    .update({
      status: giveUp ? 'failed' : 'pending',
      next_attempt_at: nextAttemptAt.toISOString(),
      locked_until: null,
      last_error: errorMessage(failure).slice(0, 2000),
    })
    .eq('id', job.id);

  if (error) throw error;

  return giveUp ? 'failed' : 'retrying';
}

/**
 * Makes a customer's waiting jobs due now, for when the event they were waiting on (typically customer.created,
 * needed by their subscription events) has just been applied.
 */
export async function releaseWaitingJobs(customerId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('customer_jobs')
    .update({ next_attempt_at: now })
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .gt('next_attempt_at', now);

  if (error) throw error;
}
