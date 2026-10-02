import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall } from '@/test/fake-supabase';
import {
  enqueueEvent,
  enqueueReconcileJobs,
  eventKeys,
  MAX_ATTEMPTS,
  PaddleEventJson,
  retryDelayMinutes,
  retryEvent,
} from './inbox';

const state = vi.hoisted(() => ({ calls: [] as FakeCall[], inserted: [] as unknown[] }));

vi.mock('@/server/db/service-role-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return {
    createServiceRoleClient: () => fakeSupabase({ webhook_inbox: { list: state.inserted } }, state.calls),
  };
});

const subscriptionCreated: PaddleEventJson = {
  event_id: 'evt_1',
  event_type: 'subscription.created',
  occurred_at: '2026-09-28T10:00:00Z',
  data: { id: 'sub_1', customer_id: 'ctm_1' },
};

describe('eventKeys', () => {
  it('reads the customer and subscription an event concerns', () => {
    expect(eventKeys(subscriptionCreated)).toEqual({ customerId: 'ctm_1', subscriptionId: 'sub_1' });
    expect(eventKeys({ ...subscriptionCreated, event_type: 'customer.created', data: { id: 'ctm_2' } })).toEqual({
      customerId: 'ctm_2',
      subscriptionId: null,
    });
    expect(
      eventKeys({
        ...subscriptionCreated,
        event_type: 'transaction.completed',
        data: { id: 'txn_1', customer_id: 'ctm_3', subscription_id: 'sub_3' },
      }),
    ).toEqual({ customerId: 'ctm_3', subscriptionId: 'sub_3' });
    expect(eventKeys({ ...subscriptionCreated, event_type: 'product.created', data: { id: 'pro_1' } })).toEqual({
      customerId: null,
      subscriptionId: null,
    });
  });
});

describe('retryDelayMinutes', () => {
  it('doubles from a minute and caps at an hour', () => {
    expect([1, 2, 3, 4, 7, 8, 12].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 60, 60, 60]);
  });
});

describe('enqueueEvent', () => {
  beforeEach(() => {
    state.calls.length = 0;
  });

  it('stores an event once, ignoring a duplicate delivery', async () => {
    state.inserted = [{ event_id: 'evt_1' }];
    await expect(enqueueEvent(subscriptionCreated)).resolves.toBe(true);
    expect(state.calls).toContainEqual({
      table: 'webhook_inbox',
      method: 'upsert',
      args: [
        {
          event_id: 'evt_1',
          event_type: 'subscription.created',
          occurred_at: '2026-09-28T10:00:00Z',
          customer_id: 'ctm_1',
          subscription_id: 'sub_1',
          payload: subscriptionCreated,
        },
        { onConflict: 'event_id', ignoreDuplicates: true },
      ],
    });

    state.inserted = [];
    await expect(enqueueEvent(subscriptionCreated)).resolves.toBe(false);
  });
});

describe('enqueueReconcileJobs', () => {
  const NOW = new Date('2026-10-31T04:00:00Z');
  const queued = () =>
    state.calls.filter(
      (call) => (call as FakeCall).table === 'webhook_inbox' && (call as FakeCall).method === 'upsert',
    );

  beforeEach(() => {
    state.calls.length = 0;
  });

  it("queues one job per customer, in the customer's order, once for each run", async () => {
    await enqueueReconcileJobs(['ctm_entitled', 'ctm_linked'], NOW);

    const [rows, options] = queued()[0].args as [Record<string, unknown>[], unknown];
    expect(rows.map((row) => row.customer_id)).toEqual(['ctm_entitled', 'ctm_linked']);
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
  });

  it('queues every customer in one write, beyond the API row limit', async () => {
    const customers = Array.from({ length: 2500 }, (_, index) => `ctm_${String(index).padStart(4, '0')}`);

    await enqueueReconcileJobs(customers, NOW);

    expect(queued()).toHaveLength(1);
    expect((queued()[0].args[0] as unknown[]).length).toBe(2500);
  });

  it('writes nothing when there is no one to reconcile', async () => {
    await enqueueReconcileJobs([], NOW);

    expect(state.calls).toEqual([]);
  });
});

describe('retryEvent', () => {
  beforeEach(() => {
    state.calls.length = 0;
  });

  const event = {
    eventId: 'evt_1',
    eventType: 'subscription.created',
    customerId: 'ctm_1',
    payload: subscriptionCreated,
  };
  const now = new Date('2026-09-28T10:00:00Z');

  it('schedules another attempt with backoff', async () => {
    await expect(retryEvent({ ...event, attempts: 3 }, new Error('customer missing'), now)).resolves.toBe('retrying');
    expect(state.calls).toContainEqual({
      table: 'webhook_inbox',
      method: 'update',
      args: [
        {
          status: 'pending',
          next_attempt_at: '2026-09-28T10:04:00.000Z',
          locked_until: null,
          last_error: 'customer missing',
        },
      ],
    });
  });

  it('gives up after the last attempt', async () => {
    await expect(retryEvent({ ...event, attempts: MAX_ATTEMPTS }, new Error('still broken'), now)).resolves.toBe(
      'failed',
    );
    expect(state.calls).toContainEqual(
      expect.objectContaining({ method: 'update', args: [expect.objectContaining({ status: 'failed' })] }),
    );
  });
});
