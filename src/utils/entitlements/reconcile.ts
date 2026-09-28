import { createClient } from '@/utils/supabase/server-internal';
import { RECONCILE_CUSTOMER_EVENT } from '@/utils/entitlements/reconcile-customer';
import { DrainResult, drainInbox } from '@/utils/webhooks/worker';

/**
 * The reconcile run (the daily cron, /api/reconcile): queues a reconcile job in the webhook inbox for every
 * customer who is entitled, has a GitHub link or has a live licence, then drains the inbox. The worker runs
 * each job (reconcile-customer.ts) in order with that customer's Paddle events and never alongside one, so
 * reconciling cannot race a webhook: a job sees the customer's entitlements as the events before it left
 * them. Jobs the drain does not reach, or that fail and back off, are picked up by later drains.
 */
export interface ReconcileResult {
  customers: number;
  inbox: DrainResult;
}

export async function reconcileEntitlements({
  now = new Date(),
  budgetMs,
}: { now?: Date; budgetMs?: number } = {}): Promise<ReconcileResult> {
  const customerIds = await customersToReconcile();
  await queueReconcileJobs(customerIds, now);

  return { customers: customerIds.length, inbox: await drainInbox({ budgetMs }) };
}

// Everyone whose access, GitHub membership or licences might need correcting.
async function customersToReconcile(): Promise<string[]> {
  const supabase = await createClient();
  const lookups = await Promise.all([
    supabase.from('customer_access').select('customer_id').in('status', ['active', 'grace']),
    supabase.from('entitlements').select('customer_id').in('status', ['active', 'grace']),
    supabase.from('github_links').select('customer_id'),
    supabase.from('licences').select('customer_id').eq('revoked', false),
  ]);

  const customerIds = new Set<string>();
  for (const { data, error } of lookups) {
    if (error) throw error;
    for (const row of (data ?? []) as { customer_id: string }[]) customerIds.add(row.customer_id);
  }

  return [...customerIds].sort();
}

async function queueReconcileJobs(customerIds: string[], now: Date) {
  if (customerIds.length === 0) return;

  const occurredAt = now.toISOString();
  const supabase = await createClient();
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
