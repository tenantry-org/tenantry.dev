import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import { getCustomerId } from './customer-dashboard';

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
}));
vi.mock('@/server/db/user-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return {
    createUserClient: async () => ({
      ...fakeSupabase(state.tables, state.calls),
      auth: { getUser: async () => ({ data: { user: state.user } }) },
    }),
  };
});

const BUYER = { email: 'buyer@example.com', email_confirmed_at: '2026-09-01T00:00:00Z' };

describe('getCustomerId', () => {
  beforeEach(() => {
    state.user = null;
    state.tables = { customers: { single: { customer_id: 'ctm_1' } } };
    state.calls.length = 0;
  });

  it('finds the customer by the confirmed email, lowercased and trimmed', async () => {
    state.user = { ...BUYER, email: ' Buyer@Example.COM ' };

    await expect(getCustomerId()).resolves.toBe('ctm_1');
    expect(state.calls).toContainEqual({ table: 'customers', method: 'eq', args: ['email', 'buyer@example.com'] });
  });

  it('finds no customer for an unconfirmed email, without looking one up', async () => {
    state.user = { ...BUYER, email_confirmed_at: null };

    await expect(getCustomerId()).resolves.toBe('');
    expect(state.calls).toEqual([]);
  });

  it('finds no customer when signed out', async () => {
    await expect(getCustomerId()).resolves.toBe('');
  });
});
