import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import {
  customersToReconcile,
  findCustomerIdByEmail,
  getGithubAccount,
  getGithubAccountHolder,
  linkGithubAccount,
  recordCustomerEvent,
  recordSubscriptionEvent,
  resetGithubState,
  setGithubState,
} from './billing-store';

// The queries and function calls the store makes, against a fake client. The billing services are tested against the
// in-memory store (src/test/memory-billing-store.ts), and the database functions in supabase/tests/database.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
  applied: true,
  /** The error the database functions fail with, if any. */
  rpcError: null as { code: string; message: string } | null,
  customers: [] as string[],
}));
vi.mock('@/server/db/service-role-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return {
    createServiceRoleClient: () =>
      fakeSupabase(state.tables, state.calls, {
        record_customer_event: () => rpcResult(state.applied),
        record_subscription_event: () => rpcResult(state.applied),
        customers_to_reconcile: () => rpcResult(state.customers),
      }),
  };
});

function rpcResult<T>(data: T): T {
  if (state.rpcError) throw state.rpcError;
  return data;
}

const rpcArgs = (name: string) => state.calls.find((call) => call.table === `rpc:${name}`)?.args[0];

beforeEach(() => {
  state.tables = {};
  state.calls.length = 0;
  state.applied = true;
  state.rpcError = null;
  state.customers = [];
});

describe('Paddle events', () => {
  it('records a subscription event with each of its fields', async () => {
    await expect(
      recordSubscriptionEvent({
        subscriptionId: 'sub_1',
        customerId: 'ctm_1',
        status: 'active',
        priceId: 'pri_1',
        productId: 'pro_1',
        scheduledChangeAt: '2026-10-01T00:00:00Z',
        scheduledChangeAction: 'cancel',
        occurredAt: '2026-09-28T11:00:00Z',
      }),
    ).resolves.toBe(true);

    expect(rpcArgs('record_subscription_event')).toEqual({
      p_subscription_id: 'sub_1',
      p_customer_id: 'ctm_1',
      p_status: 'active',
      p_price_id: 'pri_1',
      p_product_id: 'pro_1',
      p_scheduled_change_at: '2026-10-01T00:00:00Z',
      p_scheduled_change_action: 'cancel',
      p_occurred_at: '2026-09-28T11:00:00Z',
    });
  });

  it('passes null for no scheduled change, and says when a newer event was applied already', async () => {
    state.applied = false;

    await expect(
      recordSubscriptionEvent({
        subscriptionId: 'sub_1',
        customerId: 'ctm_1',
        status: 'active',
        priceId: 'pri_1',
        productId: 'pro_1',
        scheduledChangeAt: null,
        scheduledChangeAction: null,
        occurredAt: '2026-09-28T11:00:00Z',
      }),
    ).resolves.toBe(false);

    expect(rpcArgs('record_subscription_event')).toMatchObject({
      p_scheduled_change_at: null,
      p_scheduled_change_action: null,
    });
  });

  it("records a customer event's email and when it occurred", async () => {
    await expect(
      recordCustomerEvent({ customerId: 'ctm_1', email: 'buyer@example.com', occurredAt: '2026-09-29T10:00:00Z' }),
    ).resolves.toBe(true);

    expect(rpcArgs('record_customer_event')).toEqual({
      p_customer_id: 'ctm_1',
      p_email: 'buyer@example.com',
      p_occurred_at: '2026-09-29T10:00:00Z',
    });
  });

  // The worker retries an event whose recording throws; one that returned false would be completed as stale.
  it('throws when recording an event fails, such as a subscription whose customer is not recorded yet', async () => {
    state.rpcError = {
      code: '23503',
      message: 'violates foreign key constraint "subscriptions_customer_id_fkey"',
    };
    await expect(
      recordSubscriptionEvent({
        subscriptionId: 'sub_1',
        customerId: 'ctm_1',
        status: 'active',
        priceId: 'pri_1',
        productId: 'pro_1',
        scheduledChangeAt: null,
        scheduledChangeAction: null,
        occurredAt: '2026-09-28T11:00:00Z',
      }),
    ).rejects.toMatchObject({ code: '23503' });

    state.rpcError = { code: '08006', message: 'connection failure' };
    await expect(
      recordCustomerEvent({ customerId: 'ctm_1', email: 'buyer@example.com', occurredAt: '2026-09-29T10:00:00Z' }),
    ).rejects.toMatchObject({ code: '08006' });
  });
});

describe('customers', () => {
  it('finds a customer by email, or none', async () => {
    state.tables = { customers: { single: { customer_id: 'ctm_1' } } };
    await expect(findCustomerIdByEmail('buyer@example.com')).resolves.toBe('ctm_1');
    expect(state.calls).toContainEqual({ table: 'customers', method: 'eq', args: ['email', 'buyer@example.com'] });

    state.tables = {};
    await expect(findCustomerIdByEmail('nobody@example.com')).resolves.toBeNull();
  });

  // One function call returns every customer to reconcile: separate table queries were each cut off at the API's
  // row limit (max_rows, 1000).
  it('reads every customer to reconcile in one call, beyond the API row limit', async () => {
    state.customers = Array.from({ length: 2500 }, (_, index) => `ctm_${String(index).padStart(4, '0')}`);

    await expect(customersToReconcile()).resolves.toHaveLength(2500);
    expect(state.calls).toEqual([{ table: 'rpc:customers_to_reconcile', method: 'rpc', args: [{}] }]);
  });
});

describe('GitHub links', () => {
  it("reads the customer's linked account, and who holds an account", async () => {
    state.tables = {
      github_links: {
        single: (filters: Record<string, unknown>) =>
          'github_id' in filters ? { customer_id: 'ctm_2' } : { github_id: 42, github_login: 'octocat' },
      },
    };

    await expect(getGithubAccount('ctm_1')).resolves.toEqual({ id: 42, login: 'octocat' });
    await expect(getGithubAccountHolder(42)).resolves.toBe('ctm_2');
  });

  it("links an account in place of the customer's previous one", async () => {
    await expect(linkGithubAccount('ctm_1', { id: 42, login: 'octocat' })).resolves.toBe(true);

    expect(state.calls).toContainEqual({
      table: 'github_links',
      method: 'upsert',
      args: [{ customer_id: 'ctm_1', github_login: 'octocat', github_id: 42 }, { onConflict: 'customer_id' }],
    });
  });

  it('refuses an account linked to another customer (unique github_id), and throws on other errors', async () => {
    state.tables = { github_links: { writeError: { code: '23505', message: 'duplicate key value' } } };
    await expect(linkGithubAccount('ctm_1', { id: 42, login: 'octocat' })).resolves.toBe(false);

    state.tables = { github_links: { writeError: { code: '08006', message: 'connection failure' } } };
    await expect(linkGithubAccount('ctm_1', { id: 42, login: 'octocat' })).rejects.toMatchObject({ code: '08006' });
  });
});

describe('GitHub state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    return () => vi.useRealTimers();
  });

  const updates = () => state.calls.filter((call) => call.table === 'customer_access');

  it('records an invitation with when it was sent, only while the customer has access', async () => {
    await setGithubState('ctm_1', 'invited');

    expect(updates()).toEqual([
      {
        table: 'customer_access',
        method: 'update',
        args: [
          {
            github_state: 'invited',
            github_invited_at: '2026-10-01T00:00:00.000Z',
            updated_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
      { table: 'customer_access', method: 'eq', args: ['customer_id', 'ctm_1'] },
      { table: 'customer_access', method: 'in', args: ['status', ['active', 'grace']] },
    ]);
  });

  it('records a member with no invitation, and forgets the state on a relink', async () => {
    await setGithubState('ctm_1', 'active');
    await resetGithubState('ctm_1');

    expect(updates().filter((call) => call.method === 'update')).toEqual([
      expect.objectContaining({ args: [expect.objectContaining({ github_state: 'active', github_invited_at: null })] }),
      expect.objectContaining({ args: [expect.objectContaining({ github_state: 'none', github_invited_at: null })] }),
    ]);
  });
});
