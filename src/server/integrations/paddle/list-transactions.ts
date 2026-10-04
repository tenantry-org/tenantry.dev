import 'server-only';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';

/**
 * The parts of a Paddle transaction the payment ledger records (billing/apply-paddle-event.ts). The SDK's Transaction
 * entity, from the API, and its TransactionNotification, from a webhook, both have these fields under these names.
 */
export interface PaddleTransaction {
  id: string;
  status: string;
  customerId: string | null;
  origin: string;
  subscriptionId: string | null;
  billingPeriod: { startsAt: string; endsAt: string } | null;
  items: {
    price: { id: string; productId: string; billingCycle: { interval: string; frequency: number } | null } | null;
  }[];
  details: { totals: { subtotal: string; discount: string; total: string; currencyCode: string } | null } | null;
  updatedAt: string;
}

/** How many subscription ids one list request filters by. */
const SUBSCRIPTIONS_PER_REQUEST = 20;

/**
 * The completed transactions of these subscriptions billed since `billedSince`, every page of them. Reconcile records
 * any the ledger is missing, so a lost transaction.completed notification is recovered (reconcile-customer.ts).
 */
export async function listCompletedTransactions(
  subscriptionIds: string[],
  billedSince: Date,
  paddle = getPaddleInstance(),
): Promise<PaddleTransaction[]> {
  const transactions: PaddleTransaction[] = [];

  for (let i = 0; i < subscriptionIds.length; i += SUBSCRIPTIONS_PER_REQUEST) {
    const collection = paddle.transactions.list({
      subscriptionId: subscriptionIds.slice(i, i + SUBSCRIPTIONS_PER_REQUEST),
      status: ['completed'],
      'billedAt[GTE]': billedSince.toISOString(),
      perPage: 100,
    });
    do {
      transactions.push(...(await collection.next()));
    } while (collection.hasMore);
  }

  return transactions;
}
