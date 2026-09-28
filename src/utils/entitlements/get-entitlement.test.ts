import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeTable } from '@/utils/testing/fake-supabase';
import { getProAccess } from './get-entitlement';

const state = vi.hoisted(() => ({ tables: {} as Record<string, FakeTable> }));
vi.mock('@/utils/supabase/server', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return { createClient: async () => fakeSupabase(state.tables) };
});
vi.mock('@/utils/paddle/get-customer-id', () => ({ getCustomerId: async () => 'ctm_1' }));

describe('getProAccess', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    state.tables = {
      customer_access: { single: { status: 'grace', github_state: 'active', github_invited_at: null } },
      // Two past-due subscriptions: access lasts until the later one's grace ends.
      entitlements: {
        list: [{ grace_started_at: '2026-10-01T00:00:00Z' }, { grace_started_at: '2026-10-05T00:00:00Z' }],
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says when grace ends for a customer whose subscriptions are all past due', async () => {
    await expect(getProAccess()).resolves.toMatchObject({
      entitlement: { status: 'grace', grace: { endsAt: '2026-11-04T00:00:00.000Z', ended: false } },
    });
  });

  it('says when grace has ended but access has not been removed yet', async () => {
    vi.setSystemTime(new Date('2026-11-04T01:00:00Z'));

    await expect(getProAccess()).resolves.toMatchObject({ entitlement: { grace: { ended: true } } });
  });

  it('has no grace for an active customer', async () => {
    state.tables.customer_access = { single: { status: 'active', github_state: 'active', github_invited_at: null } };

    await expect(getProAccess()).resolves.toMatchObject({ entitlement: { status: 'active', grace: null } });
  });

  it('says when a pending org invitation lapses, and nothing for a member', async () => {
    state.tables.customer_access = {
      single: { status: 'active', github_state: 'invited', github_invited_at: '2026-10-18T09:00:00Z' },
    };
    await expect(getProAccess()).resolves.toMatchObject({
      entitlement: { github: 'invited', invitationExpiresAt: '2026-10-25T09:00:00.000Z' },
    });

    state.tables.customer_access = { single: { status: 'active', github_state: 'active', github_invited_at: null } };
    await expect(getProAccess()).resolves.toMatchObject({
      entitlement: { github: 'active', invitationExpiresAt: null },
    });
  });
});
