import 'server-only';
import { createServiceRoleClient } from '@/server/db/service-role-client';
import type { Json } from '@/lib/supabase/database.types';
import { errorMessage } from '@/lib/errors';

/**
 * The webhook inbox (supabase/migrations/20260928130000_webhook_inbox.sql): verified Paddle notifications,
 * stored once each and processed by the worker (jobs/worker.ts), one customer at a time and oldest first. It also
 * holds two kinds of row of our own, told apart by their event type: reconcile jobs, which run in order with the
 * customer's notifications, and customer leases (customer-lease.ts), which hold them back.
 */

/**
 * The event type of a reconcile job (reconcile-entitlements.ts queues one per customer; reconcile-customer.ts runs
 * it). The worker runs it in order with the customer's Paddle events and never at the same time as one of them, so
 * a reconcile cannot act on access that a concurrent event is changing.
 */
export const RECONCILE_CUSTOMER_EVENT = 'tenantry.reconcile_customer';

/** The event type of a lease row. The worker completes one it claims (an expired lease) as a no-op. */
export const CUSTOMER_LEASE_EVENT = 'tenantry.customer_lease';

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

export interface InboxEvent {
  eventId: string;
  eventType: string;
  customerId: string | null;
  attempts: number;
  payload: PaddleEventJson;
}

/** Attempts before an event is marked failed. With the backoff below they span about 8 hours. */
export const MAX_ATTEMPTS = 12;

/** Minutes to wait before the next attempt: doubling from one minute, capped at an hour. */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), 60);
}

/** The customer and subscription an event concerns, for ordering a customer's events. */
export function eventKeys(event: PaddleEventJson): { customerId: string | null; subscriptionId: string | null } {
  const data = event.data ?? {};
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

  if (event.event_type.startsWith('customer.')) {
    return { customerId: text(data.id), subscriptionId: null };
  }

  if (event.event_type.startsWith('subscription.')) {
    return { customerId: text(data.customer_id), subscriptionId: text(data.id) };
  }

  return { customerId: text(data.customer_id), subscriptionId: text(data.subscription_id) };
}

/**
 * Stores a verified event. Returns false if it was already stored: the primary key turns a duplicate
 * delivery, even a concurrent one, into a no-op (`INSERT … ON CONFLICT DO NOTHING`).
 */
export async function enqueueEvent(event: PaddleEventJson): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { customerId, subscriptionId } = eventKeys(event);

  const { data, error } = await supabase
    .from('webhook_inbox')
    .upsert(
      {
        event_id: event.event_id,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        customer_id: customerId,
        subscription_id: subscriptionId,
        payload: event,
      },
      { onConflict: 'event_id', ignoreDuplicates: true },
    )
    .select('event_id');

  if (error) throw error;

  return (data ?? []).length > 0;
}

/**
 * Queues a reconcile job for each customer, as of `now`. The job's event id includes `now`, so queueing the same
 * customers again for the same `now` adds nothing.
 */
export async function enqueueReconcileJobs(customerIds: string[], now: Date): Promise<void> {
  if (customerIds.length === 0) return;

  const occurredAt = now.toISOString();
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('webhook_inbox').upsert(
    customerIds.map((customerId) => {
      const eventId = `reconcile_${customerId}_${occurredAt}`;
      return {
        event_id: eventId,
        event_type: RECONCILE_CUSTOMER_EVENT,
        occurred_at: occurredAt,
        customer_id: customerId,
        subscription_id: null,
        payload: {
          event_id: eventId,
          event_type: RECONCILE_CUSTOMER_EVENT,
          occurred_at: occurredAt,
          data: { customer_id: customerId },
        },
      };
    }),
    { onConflict: 'event_id', ignoreDuplicates: true },
  );

  if (error) throw error;
}

/** Claims up to `limit` due events, at most one per customer, locking them for `lockSeconds`. */
export async function claimEvents(limit: number, lockSeconds: number): Promise<InboxEvent[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('claim_webhook_events', { p_limit: limit, p_lock_seconds: lockSeconds });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    eventId: row.event_id,
    eventType: row.event_type,
    customerId: row.customer_id,
    attempts: row.attempts,
    // What enqueueEvent or enqueueReconcileJobs stored. A lease row's (acquire_customer_lease) has only event_id
    // and event_type, and the worker never reads it.
    payload: row.payload as PaddleEventJson,
  }));
}

export async function completeEvent(eventId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('webhook_inbox')
    .update({ status: 'done', processed_at: new Date().toISOString(), locked_until: null, last_error: null })
    .eq('event_id', eventId);

  if (error) throw error;
}

/** Schedules another attempt with backoff, or marks the event failed after MAX_ATTEMPTS. */
export async function retryEvent(
  event: InboxEvent,
  failure: unknown,
  now: Date = new Date(),
): Promise<'retrying' | 'failed'> {
  const supabase = createServiceRoleClient();
  const giveUp = event.attempts >= MAX_ATTEMPTS;
  const nextAttemptAt = new Date(now.getTime() + retryDelayMinutes(event.attempts) * 60_000);

  const { error } = await supabase
    .from('webhook_inbox')
    .update({
      status: giveUp ? 'failed' : 'pending',
      next_attempt_at: nextAttemptAt.toISOString(),
      locked_until: null,
      last_error: errorMessage(failure).slice(0, 2000),
    })
    .eq('event_id', event.eventId);

  if (error) throw error;

  return giveUp ? 'failed' : 'retrying';
}

/**
 * Makes a customer's waiting events due now, for when the event they were waiting on (typically
 * customer.created, needed by their subscription events) has just been processed.
 */
export async function releaseWaitingEvents(customerId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('webhook_inbox')
    .update({ next_attempt_at: now })
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .gt('next_attempt_at', now);

  if (error) throw error;
}

/**
 * Takes the customer's lease for `seconds` (`acquire_customer_lease`): a locked inbox row that keeps the worker
 * from starting their events. Returns its id, or null while one of their events is in progress or another lease
 * is held.
 */
export async function acquireCustomerLease(customerId: string, seconds: number): Promise<string | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('acquire_customer_lease', {
    p_customer_id: customerId,
    p_seconds: seconds,
  });

  if (error) throw error;

  // The function returns null when the customer is busy; generated return types are never nullable.
  return (data as string | null) ?? null;
}

/** Releases a lease taken by acquireCustomerLease (`release_customer_lease`). */
export async function releaseCustomerLease(leaseId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.rpc('release_customer_lease', { p_lease_id: leaseId });

  if (error) throw error;
}
