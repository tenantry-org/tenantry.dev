import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import { testServerConfig } from '@/test/server-config';
import { getProAccess } from './pro-access';

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

// The Pro product is pro_01, its prices pri_01month and pri_01year.
const { paddle } = testServerConfig();

const BUYER = { email: 'buyer@example.com', email_confirmed_at: '2026-09-01T00:00:00Z' };

describe('getProAccess', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    state.user = BUYER;
    state.tables = {
      customers: { single: { customer_id: 'ctm_1' } },
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
  });

  it('says when grace ends for a customer whose subscriptions are all past due', async () => {
    await expect(getProAccess(paddle)).resolves.toMatchObject({
      entitlement: { status: 'grace', grace: { endsAt: '2026-11-04T00:00:00.000Z', ended: false } },
    });
  });

  it('says when grace has ended but access has not been removed yet', async () => {
    vi.setSystemTime(new Date('2026-11-04T01:00:00Z'));

    await expect(getProAccess(paddle)).resolves.toMatchObject({ entitlement: { grace: { ended: true } } });
  });

  it('has no grace for an active customer', async () => {
    state.tables.customer_access = { single: { status: 'active', github_state: 'active', github_invited_at: null } };

    await expect(getProAccess(paddle)).resolves.toMatchObject({ entitlement: { status: 'active', grace: null } });
  });

  it('says when a pending org invitation lapses, and nothing for a member', async () => {
    state.tables.customer_access = {
      single: { status: 'active', github_state: 'invited', github_invited_at: '2026-10-18T09:00:00Z' },
    };
    await expect(getProAccess(paddle)).resolves.toMatchObject({
      entitlement: { github: 'invited', invitationExpiresAt: '2026-10-25T09:00:00.000Z' },
    });

    state.tables.customer_access = { single: { status: 'active', github_state: 'active', github_invited_at: null } };
    await expect(getProAccess(paddle)).resolves.toMatchObject({
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

      await expect(getProAccess(paddle)).resolves.toMatchObject({
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

      await expect(getProAccess(paddle)).resolves.toMatchObject({
        subscriptions: [{ id: 'sub_renews', renewsAt: '2026-11-01T00:00:00Z', endsAt: null }],
      });
    });

    it("names each subscription's billing interval by its price", async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews', { price_id: 'pri_01month' }),
          subscription('sub_ends', { price_id: 'pri_01year' }),
          subscription('sub_other_price'),
        ],
      };

      await expect(getProAccess(paddle)).resolves.toMatchObject({
        subscriptions: [
          { id: 'sub_renews', interval: 'month' },
          { id: 'sub_ends', interval: 'year' },
          { id: 'sub_other_price', interval: null },
        ],
      });
    });

    it('leaves out ended subscriptions and other products', async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews', { subscription_status: 'canceled' }),
          subscription('sub_other', { product_id: 'pro_other' }),
        ],
      };

      await expect(getProAccess(paddle)).resolves.toMatchObject({ subscriptions: [] });
    });
  });
});
