import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/utils/testing/fake-supabase';
import { reconcileEntitlements } from './reconcile';

const worker = vi.hoisted(() => ({ drainInbox: vi.fn() }));
vi.mock('@/utils/webhooks/worker', () => worker);

const state = vi.hoisted(() => ({
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
  customers: [] as string[],
}));
// customers_to_reconcile is tested against the database in supabase/tests/database/reconcile.test.sql.
vi.mock('@/utils/supabase/server-internal', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return {
    createClient: async () =>
      fakeSupabase(state.tables, state.calls, { customers_to_reconcile: () => state.customers }),
  };
});

const NOW = new Date('2026-10-31T04:00:00Z');

describe('reconcileEntitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls.length = 0;
    worker.drainInbox.mockResolvedValue({ processed: 3, retrying: 0, failed: 0 });
    state.tables = {};
    state.customers = ['ctm_entitled', 'ctm_linked', 'ctm_revoked_by_mistake'];
  });

  it('queues one reconcile job per customer who is entitled, linked or licensed, then drains the inbox', async () => {
    await expect(reconcileEntitlements({ now: NOW, budgetMs: 45_000 })).resolves.toEqual({
      customers: 3,
      inbox: { processed: 3, retrying: 0, failed: 0 },
    });

    const queued = state.calls.find((call) => call.table === 'webhook_inbox' && call.method === 'upsert');
    const [rows, options] = queued!.args as [Record<string, unknown>[], unknown];
    expect(rows.map((row) => row.customer_id)).toEqual(['ctm_entitled', 'ctm_linked', 'ctm_revoked_by_mistake']);
    expect(rows[0]).toEqual({
      event_id: 'reconcile_ctm_entitled_2026-10-31T04:00:00.000Z',
      event_type: 'tenantry.reconcile_customer',
      occurred_at: '2026-10-31T04:00:00.000Z',
      customer_id: 'ctm_entitled',
      subscription_id: null,
      payload: {
        event_id: 'reconcile_ctm_entitled_2026-10-31T04:00:00.000Z',
        event_type: 'tenantry.reconcile_customer',
        occurred_at: '2026-10-31T04:00:00.000Z',
        data: { customer_id: 'ctm_entitled' },
      },
    });
    expect(options).toEqual({ onConflict: 'event_id', ignoreDuplicates: true });
    expect(worker.drainInbox).toHaveBeenCalledWith({ budgetMs: 45_000 });
  });

  it('queues every customer the database returns, beyond the API row limit', async () => {
    state.customers = Array.from({ length: 2500 }, (_, index) => `ctm_${String(index).padStart(4, '0')}`);

    await expect(reconcileEntitlements({ now: NOW })).resolves.toMatchObject({ customers: 2500 });

    const queued = state.calls.find((call) => call.table === 'webhook_inbox' && call.method === 'upsert');
    expect((queued!.args[0] as unknown[]).length).toBe(2500);
  });

  it('queues nothing when there is no one to reconcile, and still drains the inbox', async () => {
    state.customers = [];

    await expect(reconcileEntitlements({ now: NOW })).resolves.toMatchObject({ customers: 0 });
    expect(state.calls).not.toContainEqual(expect.objectContaining({ table: 'webhook_inbox' }));
    expect(worker.drainInbox).toHaveBeenCalledOnce();
  });
});
