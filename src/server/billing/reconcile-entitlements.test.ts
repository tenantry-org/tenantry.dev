import { describe, expect, it, vi } from 'vitest';
import { type ReconcileDeps, reconcileEntitlements } from './reconcile-entitlements';

const NOW = new Date('2026-10-31T04:00:00Z');

function fakeDeps(customers: string[]) {
  return {
    // customers_to_reconcile is tested against the database in supabase/tests/database/reconcile.test.sql.
    customersToReconcile: vi.fn<ReconcileDeps['customersToReconcile']>(async () => customers),
    enqueueReconcileJobs: vi.fn<ReconcileDeps['enqueueReconcileJobs']>(async () => undefined),
    processJobs: vi.fn<ReconcileDeps['processJobs']>(async () => ({ processed: 3, retrying: 0, failed: 0 })),
    deleteFeedDownloadsBefore: vi.fn<ReconcileDeps['deleteFeedDownloadsBefore']>(async () => 2),
  } satisfies ReconcileDeps;
}

describe('reconcileEntitlements', () => {
  it('queues one reconcile job per customer who is entitled, linked or licensed, then runs the due jobs', async () => {
    const deps = fakeDeps(['ctm_entitled', 'ctm_linked', 'ctm_revoked_by_mistake']);

    await expect(reconcileEntitlements({ now: NOW, budgetMs: 45_000 }, deps)).resolves.toEqual({
      customers: 3,
      jobs: { processed: 3, retrying: 0, failed: 0 },
      feedDownloadsDeleted: 2,
    });

    expect(deps.enqueueReconcileJobs).toHaveBeenCalledExactlyOnceWith(
      ['ctm_entitled', 'ctm_linked', 'ctm_revoked_by_mistake'],
      NOW,
    );
    expect(deps.processJobs).toHaveBeenCalledWith({ budgetMs: 45_000 });
    expect(deps.enqueueReconcileJobs.mock.invocationCallOrder[0]).toBeLessThan(
      deps.processJobs.mock.invocationCallOrder[0],
    );
  });

  it('deletes the feed download records older than 90 days before the jobs, which can run to the time limit', async () => {
    const deps = fakeDeps([]);

    await reconcileEntitlements({ now: NOW }, deps);

    expect(deps.deleteFeedDownloadsBefore).toHaveBeenCalledExactlyOnceWith(new Date('2026-08-02T04:00:00Z'));
    expect(deps.deleteFeedDownloadsBefore.mock.invocationCallOrder[0]).toBeLessThan(
      deps.processJobs.mock.invocationCallOrder[0],
    );
  });

  it('still runs the due jobs when there is no one to reconcile', async () => {
    const deps = fakeDeps([]);

    await expect(reconcileEntitlements({ now: NOW }, deps)).resolves.toMatchObject({ customers: 0 });
    expect(deps.processJobs).toHaveBeenCalledOnce();
  });
});
