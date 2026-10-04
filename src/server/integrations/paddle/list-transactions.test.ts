import { describe, expect, it, vi } from 'vitest';
import { listCompletedTransactions } from './list-transactions';

describe('listCompletedTransactions', () => {
  it('asks for the completed transactions of the subscriptions since the date, every page, in batches', async () => {
    const pages = [[{ id: 'txn_1' }], [{ id: 'txn_2' }]];
    const list = vi.fn(() => {
      const remaining = [...pages];
      const collection = {
        hasMore: true,
        next: vi.fn(async () => {
          const page = remaining.shift() ?? [];
          collection.hasMore = remaining.length > 0;
          return page;
        }),
      };
      return collection;
    });
    const paddle = { transactions: { list } } as unknown as Parameters<typeof listCompletedTransactions>[2];
    const subscriptions = Array.from({ length: 25 }, (_, i) => `sub_${i}`);

    const transactions = await listCompletedTransactions(subscriptions, new Date('2026-07-01T00:00:00Z'), paddle);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, {
      subscriptionId: subscriptions.slice(0, 20),
      status: ['completed'],
      'billedAt[GTE]': '2026-07-01T00:00:00.000Z',
      perPage: 100,
    });
    expect(list.mock.calls[1]).toEqual([expect.objectContaining({ subscriptionId: subscriptions.slice(20) })]);
    expect(transactions.map((transaction) => transaction.id)).toEqual(['txn_1', 'txn_2', 'txn_1', 'txn_2']);
  });

  it('stops after a bounded number of pages, even if Paddle always says there are more', async () => {
    const next = vi.fn(async () => [{ id: 'txn_again' }]);
    const list = vi.fn(() => ({ hasMore: true, next }));
    const paddle = { transactions: { list } } as unknown as Parameters<typeof listCompletedTransactions>[2];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await listCompletedTransactions(['sub_1'], new Date('2026-07-01T00:00:00Z'), paddle);

    expect(next).toHaveBeenCalledTimes(20);
    expect(warn).toHaveBeenCalledOnce();
  });
});
