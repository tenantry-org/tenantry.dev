import { describe, expect, it, vi } from 'vitest';
import { applyPaddleEvent } from './apply-paddle-event';
import { processJobs } from './process-jobs';
import { reconcileCustomer } from './reconcile-customer';

const worker = vi.hoisted(() => ({ drainJobs: vi.fn(async () => ({ processed: 1, retrying: 0, failed: 0 })) }));
vi.mock('@/server/jobs/worker', () => worker);

describe('processJobs', () => {
  it("runs the due jobs with the billing services' handlers, within the time budget", async () => {
    await expect(processJobs({ budgetMs: 45_000 })).resolves.toEqual({ processed: 1, retrying: 0, failed: 0 });

    expect(worker.drainJobs).toHaveBeenCalledExactlyOnceWith(
      { applyPaddleEvent, reconcileCustomer },
      { budgetMs: 45_000 },
    );
  });
});
