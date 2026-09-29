import { createClient } from '@/utils/supabase/server-internal';
import { errorMessage } from '@/utils/errors';

/**
 * The webhook inbox (supabase/migrations/20260928130000_webhook_inbox.sql): verified Paddle notifications,
 * stored once each and processed by the worker (./worker.ts), one customer at a time and oldest first.
 */

/** A Paddle notification as delivered: the verified JSON body, in Paddle's snake_case. */
export interface PaddleEventJson {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

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
  const supabase = createClient();
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

/** Claims up to `limit` due events, at most one per customer, locking them for `lockSeconds`. */
export async function claimEvents(limit: number, lockSeconds: number): Promise<InboxEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('claim_webhook_events', { p_limit: limit, p_lock_seconds: lockSeconds });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    eventId: row.event_id as string,
    eventType: row.event_type as string,
    customerId: (row.customer_id as string | null) ?? null,
    attempts: row.attempts as number,
    payload: row.payload as PaddleEventJson,
  }));
}

export async function completeEvent(eventId: string): Promise<void> {
  const supabase = createClient();
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
  const supabase = createClient();
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
  const supabase = createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('webhook_inbox')
    .update({ next_attempt_at: now })
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .gt('next_attempt_at', now);

  if (error) throw error;
}
