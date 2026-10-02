import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall } from '@/test/fake-supabase';
import type { Tables } from '@/lib/supabase/database.types';
import {
  claimJobs,
  enqueuePaddleEvent,
  enqueueReconcileJobs,
  eventCustomerId,
  type Job,
  MAX_ATTEMPTS,
  PaddleEventJson,
  retryDelayMinutes,
  retryJob,
} from './customer-jobs';

const state = vi.hoisted(() => ({
  calls: [] as FakeCall[],
  inserted: [] as unknown[],
  claimed: [] as unknown[],
}));

vi.mock('@/server/db/service-role-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return {
    createServiceRoleClient: () =>
      fakeSupabase({ customer_jobs: { list: state.inserted } }, state.calls, {
        claim_customer_jobs: () => state.claimed,
      }),
  };
});

const subscriptionCreated: PaddleEventJson = {
  event_id: 'evt_1',
  event_type: 'subscription.created',
  occurred_at: '2026-09-28T10:00:00Z',
  data: { id: 'sub_1', customer_id: 'ctm_1' },
};

beforeEach(() => {
  state.calls.length = 0;
});

describe('eventCustomerId', () => {
  it('reads the customer an event concerns', () => {
    expect(eventCustomerId(subscriptionCreated)).toBe('ctm_1');
    expect(eventCustomerId({ ...subscriptionCreated, event_type: 'customer.created', data: { id: 'ctm_2' } })).toBe(
      'ctm_2',
    );
    expect(
      eventCustomerId({
        ...subscriptionCreated,
        event_type: 'transaction.completed',
        data: { id: 'txn_1', customer_id: 'ctm_3', subscription_id: 'sub_3' },
      }),
    ).toBe('ctm_3');
    expect(eventCustomerId({ ...subscriptionCreated, event_type: 'product.created', data: { id: 'pro_1' } })).toBe(
      null,
    );
  });
});

describe('retryDelayMinutes', () => {
  it('doubles from a minute and caps at an hour', () => {
    expect([1, 2, 3, 4, 7, 8, 12].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 60, 60, 60]);
  });
});

describe('enqueuePaddleEvent', () => {
  it('stores an event once, ignoring a duplicate delivery', async () => {
    state.inserted = [{ id: 'evt_1' }];
    await expect(enqueuePaddleEvent(subscriptionCreated)).resolves.toBe(true);
    expect(state.calls).toContainEqual({
      table: 'customer_jobs',
      method: 'upsert',
      args: [
        {
          id: 'evt_1',
          kind: 'paddle_event',
          customer_id: 'ctm_1',
          occurred_at: '2026-09-28T10:00:00Z',
          event_type: 'subscription.created',
          payload: subscriptionCreated,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      ],
    });

    state.inserted = [];
    await expect(enqueuePaddleEvent(subscriptionCreated)).resolves.toBe(false);
  });
});

describe('enqueueReconcileJobs', () => {
  const NOW = new Date('2026-10-31T04:00:00Z');
  const queued = () =>
    state.calls.filter(
      (call) => (call as FakeCall).table === 'customer_jobs' && (call as FakeCall).method === 'upsert',
    );

  it("queues one job per customer, in the customer's order, once for each run", async () => {
    await enqueueReconcileJobs(['ctm_entitled', 'ctm_linked'], NOW);

    const [rows, options] = queued()[0].args as [Record<string, unknown>[], unknown];
    expect(rows).toEqual([
      {
        id: 'reconcile_ctm_entitled_2026-10-31T04:00:00.000Z',
        kind: 'reconcile',
        customer_id: 'ctm_entitled',
        occurred_at: '2026-10-31T04:00:00.000Z',
      },
      {
        id: 'reconcile_ctm_linked_2026-10-31T04:00:00.000Z',
        kind: 'reconcile',
        customer_id: 'ctm_linked',
        occurred_at: '2026-10-31T04:00:00.000Z',
      },
    ]);
    expect(options).toEqual({ onConflict: 'id', ignoreDuplicates: true });
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

describe('claimJobs', () => {
  function row(overrides: Partial<Tables<'customer_jobs'>>): Tables<'customer_jobs'> {
    return {
      id: 'job',
      kind: 'reconcile',
      customer_id: 'ctm_1',
      occurred_at: '2026-10-31T04:00:00+00:00',
      event_type: null,
      payload: null,
      status: 'pending',
      attempts: 1,
      next_attempt_at: '2026-10-31T04:00:00+00:00',
      locked_until: '2026-10-31T04:02:00+00:00',
      last_error: null,
      created_at: '2026-10-31T04:00:00+00:00',
      processed_at: null,
      ...overrides,
    };
  }

  it('claims the due jobs, each as its kind', async () => {
    state.claimed = [
      row({ id: 'evt_1', kind: 'paddle_event', event_type: 'subscription.created', payload: subscriptionCreated }),
      row({ id: 'evt_2', kind: 'paddle_event', customer_id: null, event_type: 'product.created', payload: {} }),
      row({ id: 'reconcile_ctm_2', customer_id: 'ctm_2', attempts: 3 }),
      row({ id: 'lease_ctm_3', kind: 'lease', customer_id: 'ctm_3' }),
    ];

    await expect(claimJobs(5, 120)).resolves.toEqual([
      { id: 'evt_1', attempts: 1, kind: 'paddle_event', customerId: 'ctm_1', event: subscriptionCreated },
      { id: 'evt_2', attempts: 1, kind: 'paddle_event', customerId: null, event: {} },
      { id: 'reconcile_ctm_2', attempts: 3, kind: 'reconcile', customerId: 'ctm_2' },
      { id: 'lease_ctm_3', attempts: 1, kind: 'lease', customerId: 'ctm_3' },
    ]);
    expect(state.calls).toContainEqual({
      table: 'rpc:claim_customer_jobs',
      method: 'rpc',
      args: [{ p_limit: 5, p_lock_seconds: 120 }],
    });
  });

  it('fails on a job of a kind it does not know, rather than skip it', async () => {
    state.claimed = [row({ id: 'job_new', kind: 'refund' })];

    await expect(claimJobs(5, 120)).rejects.toThrow('Job job_new is of an unknown kind: refund');
  });
});

describe('retryJob', () => {
  const job: Job = { id: 'evt_1', attempts: 1, kind: 'paddle_event', customerId: 'ctm_1', event: subscriptionCreated };
  const now = new Date('2026-09-28T10:00:00Z');

  it('schedules another attempt with backoff', async () => {
    await expect(retryJob({ ...job, attempts: 3 }, new Error('customer missing'), now)).resolves.toBe('retrying');
    expect(state.calls).toContainEqual({
      table: 'customer_jobs',
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
    expect(state.calls).toContainEqual({ table: 'customer_jobs', method: 'eq', args: ['id', 'evt_1'] });
  });

  it('gives up after the last attempt', async () => {
    await expect(retryJob({ ...job, attempts: MAX_ATTEMPTS }, new Error('still broken'), now)).resolves.toBe('failed');
    expect(state.calls).toContainEqual(
      expect.objectContaining({ method: 'update', args: [expect.objectContaining({ status: 'failed' })] }),
    );
  });
});
