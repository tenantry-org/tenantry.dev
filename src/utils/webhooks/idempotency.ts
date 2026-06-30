import { createClient } from '@/utils/supabase/server-internal';

/**
 * Idempotency guard for Paddle webhooks. Paddle delivers at least once; recording each processed
 * event id lets us skip duplicates so licences aren't re-issued and GitHub isn't re-called.
 */

/** Returns true if this Paddle event id has already been processed successfully. */
export async function hasProcessed(eventId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('processed_webhook_events')
    .select('event_id')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) throw error;

  return data != null;
}

/** Marks an event id as processed. Call only after the event has been handled successfully. */
export async function markProcessed(eventId: string, eventType: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('processed_webhook_events')
    .upsert({ event_id: eventId, event_type: eventType }, { onConflict: 'event_id' });

  if (error) throw error;
}
