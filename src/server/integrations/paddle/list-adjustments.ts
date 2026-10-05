import 'server-only';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';

/**
 * The parts of a Paddle adjustment the payment ledger records (billing/apply-paddle-event.ts: recordAdjustment). The
 * SDK's Adjustment entity, from the API, and its AdjustmentNotification, from a webhook, both have these fields under
 * these names (paddle-assumptions.ts, assumption 7).
 */
export interface PaddleAdjustment {
  id: string;
  action: string;
  type: string;
  status: string;
  transactionId: string;
  subscriptionId: string | null;
  customerId: string;
  currencyCode?: string | null;
  items: { type: string }[];
  totals: { subtotal: string; currencyCode?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

/** How many subscription ids one list request filters by. */
const SUBSCRIPTIONS_PER_REQUEST = 20;
/** How many pages of 50 one request may take before the listing stops: far more than a customer's adjustments. */
const MAX_PAGES = 20;

/**
 * Every adjustment of these subscriptions, every page of them (Paddle's list has no date filter). Reconcile records
 * any the ledger is missing or holds in an older state, so a lost adjustment notification is recovered
 * (reconcile-customer.ts).
 */
export async function listAdjustments(
  subscriptionIds: string[],
  paddle = getPaddleInstance(),
): Promise<PaddleAdjustment[]> {
  const adjustments: PaddleAdjustment[] = [];

  for (let i = 0; i < subscriptionIds.length; i += SUBSCRIPTIONS_PER_REQUEST) {
    const collection = paddle.adjustments.list({
      subscriptionId: subscriptionIds.slice(i, i + SUBSCRIPTIONS_PER_REQUEST),
      perPage: 50,
    });
    let pages = 0;
    do {
      adjustments.push(...((await collection.next()) as unknown as PaddleAdjustment[]));
      pages++;
    } while (collection.hasMore && pages < MAX_PAGES);
    if (collection.hasMore) {
      console.warn(`Paddle: listing adjustments stopped after ${MAX_PAGES} pages with more to come.`);
    }
  }

  return adjustments;
}
