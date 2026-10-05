import { describe, expect, it, vi } from 'vitest';
import { listAdjustments } from './list-adjustments';

describe('listAdjustments', () => {
  it('asks for the adjustments of the subscriptions, every page, in batches, and stops after a bounded number', async () => {
    const pages = [[{ id: 'adj_1' }], [{ id: 'adj_2' }]];
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
    const paddle = { adjustments: { list } } as unknown as Parameters<typeof listAdjustments>[1];
    const subscriptions = Array.from({ length: 25 }, (_, i) => `sub_${i}`);

    const adjustments = await listAdjustments(subscriptions, paddle);

    expect(list).toHaveBeenNthCalledWith(1, { subscriptionId: subscriptions.slice(0, 20), perPage: 50 });
    expect(list.mock.calls[1]).toEqual([{ subscriptionId: subscriptions.slice(20), perPage: 50 }]);
    expect(adjustments.map((adjustment) => adjustment.id)).toEqual(['adj_1', 'adj_2', 'adj_1', 'adj_2']);
  });

  it('stops after a bounded number of pages, even if Paddle always says there are more', async () => {
    const next = vi.fn(async () => [{ id: 'adj_again' }]);
    const paddle = {
      adjustments: { list: vi.fn(() => ({ hasMore: true, next })) },
    } as unknown as Parameters<typeof listAdjustments>[1];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await listAdjustments(['sub_1'], paddle);

    expect(next).toHaveBeenCalledTimes(20);
  });
});
