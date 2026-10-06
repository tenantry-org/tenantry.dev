import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import {
  getCustomerId,
  isTestCustomer,
  readCustomerState,
  readFeedTokens,
  readLicenceKey,
  readSubscriptions,
  readVested,
} from './customer-dashboard';

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
}));
// The user comes from the request's cached lookup (current-user.ts): the client has no auth to read it again.
vi.mock('@/server/db/current-user', () => ({ getCurrentUser: async () => state.user }));
vi.mock('@/server/db/user-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return { createUserClient: async () => fakeSupabase(state.tables, state.calls) };
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

    await expect(getCustomerId()).resolves.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it('finds no customer when signed out', async () => {
    await expect(getCustomerId()).resolves.toBeNull();
  });

  it('finds none when no purchase was made with the email', async () => {
    state.user = BUYER;
    state.tables.customers = {};

    await expect(getCustomerId()).resolves.toBeNull();
  });
});

describe('a read that fails', () => {
  const failure = { code: '57014', message: 'canceling statement due to statement timeout' };

  beforeEach(() => {
    state.user = BUYER;
    state.calls.length = 0;
    state.tables = Object.fromEntries(
      ['customers', 'active_subscriptions', 'vested_entitlements', 'feed_tokens', 'licences', 'subscriptions'].map(
        (table) => [table, { readError: failure }],
      ),
    );
  });

  it('throws, rather than reading as no account, no access or nothing held', async () => {
    await expect(getCustomerId()).rejects.toEqual(failure);
    await expect(isTestCustomer('ctm_1')).rejects.toEqual(failure);
    await expect(readCustomerState('ctm_1')).rejects.toEqual(failure);
    await expect(readVested('ctm_1')).rejects.toEqual(failure);
    await expect(readFeedTokens('ctm_1')).rejects.toEqual(failure);
    await expect(readLicenceKey('ctm_1')).rejects.toEqual(failure);
    await expect(readSubscriptions('ctm_1')).rejects.toEqual(failure);
  });
});
