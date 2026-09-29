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
    vi.stubEnv('PADDLE_PRO_PRODUCT_ID', 'pro_01');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    state.tables = {
      customer_access: { single: { status: 'grace', github_state: 'active', github_invited_at: null } },
      // Two past-due subscriptions: access lasts until the later one's grace ends.
      entitlements: {
        list: [
          { subscription_id: 'sub_a', status: 'grace', grace_started_at: '2026-10-01T00:00:00Z' },
          { subscription_id: 'sub_b', status: 'grace', grace_started_at: '2026-10-05T00:00:00Z' },
        ],
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

  describe('billing', () => {
    const subscription = (id: string, extra: Record<string, unknown> = {}) => ({
      subscription_id: id,
      subscription_status: 'active',
      price_id: 'pri_unknown',
      product_id: 'pro_01',
      scheduled_change: null,
      scheduled_change_action: null,
      ...extra,
    });

    beforeEach(() => {
      state.tables.entitlements = {
        list: [
          { subscription_id: 'sub_renews', status: 'active', current_period_ends_at: '2026-11-01T00:00:00Z' },
          { subscription_id: 'sub_ends', status: 'active', current_period_ends_at: '2026-11-15T00:00:00Z' },
        ],
      };
    });

    it('says when each Pro subscription renews, or when a scheduled cancellation ends it', async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews'),
          subscription('sub_ends', { scheduled_change: '2026-11-15T00:00:00Z', scheduled_change_action: 'cancel' }),
        ],
      };

      await expect(getProAccess()).resolves.toMatchObject({
        subscriptions: [
          { id: 'sub_renews', status: 'active', renewsAt: '2026-11-01T00:00:00Z', endsAt: null },
          { id: 'sub_ends', renewsAt: null, endsAt: '2026-11-15T00:00:00Z' },
        ],
      });
    });

    it('does not call another scheduled change an ending', async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews', { scheduled_change: '2026-11-01T00:00:00Z', scheduled_change_action: 'pause' }),
        ],
      };

      await expect(getProAccess()).resolves.toMatchObject({
        subscriptions: [{ id: 'sub_renews', renewsAt: '2026-11-01T00:00:00Z', endsAt: null }],
      });
    });

    it('leaves out ended subscriptions and other products', async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews', { subscription_status: 'canceled' }),
          subscription('sub_other', { product_id: 'pro_other' }),
        ],
      };

      await expect(getProAccess()).resolves.toMatchObject({ subscriptions: [] });
    });
  });
});
