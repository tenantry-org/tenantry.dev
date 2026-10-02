import { describe, expect, it, vi } from 'vitest';
import { applyPaddleEvent } from './apply-paddle-event';
import { processInbox } from './process-inbox';
import { reconcileCustomer } from './reconcile-customer';

const worker = vi.hoisted(() => ({ drainInbox: vi.fn(async () => ({ processed: 1, retrying: 0, failed: 0 })) }));
vi.mock('@/server/jobs/worker', () => worker);

describe('processInbox', () => {
  it("drains the inbox with the billing services' handlers, within the time budget", async () => {
    await expect(processInbox({ budgetMs: 45_000 })).resolves.toEqual({ processed: 1, retrying: 0, failed: 0 });

    expect(worker.drainInbox).toHaveBeenCalledExactlyOnceWith(
      { applyPaddleEvent, reconcileCustomer },
      { budgetMs: 45_000 },
    );
  });
});
