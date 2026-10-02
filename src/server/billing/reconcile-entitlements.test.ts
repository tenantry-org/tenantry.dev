import { describe, expect, it, vi } from 'vitest';
import { type ReconcileDeps, reconcileEntitlements } from './reconcile-entitlements';

const NOW = new Date('2026-10-31T04:00:00Z');

function fakeDeps(customers: string[]) {
  return {
    // customers_to_reconcile is tested against the database in supabase/tests/database/reconcile.test.sql.
    customersToReconcile: vi.fn<ReconcileDeps['customersToReconcile']>(async () => customers),
    enqueueReconcileJobs: vi.fn<ReconcileDeps['enqueueReconcileJobs']>(async () => undefined),
    processInbox: vi.fn<ReconcileDeps['processInbox']>(async () => ({ processed: 3, retrying: 0, failed: 0 })),
  } satisfies ReconcileDeps;
}

describe('reconcileEntitlements', () => {
  it('queues one reconcile job per customer who is entitled, linked or licensed, then drains the inbox', async () => {
    const deps = fakeDeps(['ctm_entitled', 'ctm_linked', 'ctm_revoked_by_mistake']);

    await expect(reconcileEntitlements({ now: NOW, budgetMs: 45_000 }, deps)).resolves.toEqual({
      customers: 3,
      inbox: { processed: 3, retrying: 0, failed: 0 },
    });

    expect(deps.enqueueReconcileJobs).toHaveBeenCalledExactlyOnceWith(
      ['ctm_entitled', 'ctm_linked', 'ctm_revoked_by_mistake'],
      NOW,
    );
    expect(deps.processInbox).toHaveBeenCalledWith({ budgetMs: 45_000 });
    expect(deps.enqueueReconcileJobs.mock.invocationCallOrder[0]).toBeLessThan(
      deps.processInbox.mock.invocationCallOrder[0],
    );
  });

  it('still drains the inbox when there is no one to reconcile', async () => {
    const deps = fakeDeps([]);

    await expect(reconcileEntitlements({ now: NOW }, deps)).resolves.toMatchObject({ customers: 0 });
    expect(deps.processInbox).toHaveBeenCalledOnce();
  });
});
