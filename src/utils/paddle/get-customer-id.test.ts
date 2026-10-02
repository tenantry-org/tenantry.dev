import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall } from '@/utils/testing/fake-supabase';
import { getCustomerId } from './get-customer-id';

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  calls: [] as FakeCall[],
}));

vi.mock('@/utils/supabase/user-client', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return {
    createUserClient: async () => ({
      ...fakeSupabase({ customers: { single: { customer_id: 'ctm_1' } } }, state.calls),
      auth: { getUser: async () => ({ data: { user: state.user } }) },
    }),
  };
});

describe('getCustomerId', () => {
  beforeEach(() => {
    state.user = null;
    state.calls.length = 0;
  });

  it('finds the customer by the confirmed email, lowercased and trimmed', async () => {
    state.user = { email: ' Buyer@Example.COM ', email_confirmed_at: '2026-09-01T00:00:00Z' };

    await expect(getCustomerId()).resolves.toBe('ctm_1');
    expect(state.calls).toContainEqual({ table: 'customers', method: 'eq', args: ['email', 'buyer@example.com'] });
  });

  it('finds no customer for an unconfirmed email, without looking one up', async () => {
    state.user = { email: 'buyer@example.com', email_confirmed_at: null };

    await expect(getCustomerId()).resolves.toBe('');
    expect(state.calls).toEqual([]);
  });

  it('finds no customer when signed out', async () => {
    await expect(getCustomerId()).resolves.toBe('');
  });
});
