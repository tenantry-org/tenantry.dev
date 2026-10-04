import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import { testServerConfig } from '@/test/server-config';
import { getAccessView, getBillingView, getInstallView } from './pro-pages';

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
}));
vi.mock('@/server/db/current-user', () => ({ getCurrentUser: async () => state.user }));
vi.mock('@/server/db/user-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return { createUserClient: async () => fakeSupabase(state.tables, state.calls) };
});

// The Pro product is pro_01, its prices pri_01month and pri_01year.
const { paddle } = testServerConfig();

const BUYER = { email: 'buyer@example.com', email_confirmed_at: '2026-09-01T00:00:00Z' };

const access = (status: string) => ({ single: { access_status: status } });

// The tables a read model read, besides the customer lookup.
const tablesRead = () => new Set(state.calls.map(({ table }) => table).filter((table) => table !== 'customers'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  state.user = BUYER;
  state.calls.length = 0;
  state.tables = {
    customers: { single: { customer_id: 'ctm_1' } },
    active_subscriptions: access('active'),
    licences: { single: { jwt: 'licence.key' } },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['Access', getAccessView],
  ['Install', getInstallView],
  ['Billing', () => getBillingView(paddle)],
])('the %s page, for a login with no billing account', (_, view) => {
  it('says no purchase was made with its email', async () => {
    state.tables.customers = {};

    await expect(view()).resolves.toEqual({
      noSubscription: true,
      customer: false,
      accountEmail: 'buyer@example.com',
      licenceKey: null,
    });
    expect(tablesRead()).toEqual(new Set());
  });
});

describe('getAccessView', () => {
  it('shows a customer with Pro their licence key, and reads nothing else', async () => {
    await expect(getAccessView()).resolves.toEqual({ noSubscription: false, licenceKey: 'licence.key' });
    expect(tablesRead()).toEqual(new Set(['active_subscriptions', 'licences']));
  });

  it('shows a customer in grace their access', async () => {
    state.tables.active_subscriptions = access('grace');

    await expect(getAccessView()).resolves.toMatchObject({ noSubscription: false });
  });

  it('shows a former customer no access, points them to billing, and still shows their licence key', async () => {
    state.tables.active_subscriptions = access('lapsed');

    await expect(getAccessView()).resolves.toEqual({
      noSubscription: true,
      customer: true,
      accountEmail: 'buyer@example.com',
      licenceKey: 'licence.key',
    });
    expect(state.calls).not.toContainEqual(
      expect.objectContaining({ table: 'licences', method: 'eq', args: ['revoked', false] }),
    );
  });

  it('shows no access to a customer whose access was never recorded', async () => {
    state.tables.active_subscriptions = {};

    await expect(getAccessView()).resolves.toMatchObject({ noSubscription: true, customer: true });
  });
});

describe('getInstallView', () => {
  it('shows a customer with Pro the install steps, and reads no licence', async () => {
    await expect(getInstallView()).resolves.toEqual({ noSubscription: false });
    expect(tablesRead()).toEqual(new Set(['active_subscriptions']));
  });

  it('shows a former customer no install steps', async () => {
    state.tables.active_subscriptions = access('lapsed');

    await expect(getInstallView()).resolves.toMatchObject({ noSubscription: true, customer: true });
  });
});

describe('getBillingView', () => {
  beforeEach(() => {
    state.tables.active_subscriptions = access('grace');
    // Two past-due Pro subscriptions: access lasts until the later one's grace ends. Another product's does not count.
    state.tables.subscriptions = {
      list: [
        {
          subscription_id: 'sub_a',
          product_id: 'pro_01',
          status: 'past_due',
          grace_started_at: '2026-10-01T00:00:00Z',
        },
        {
          subscription_id: 'sub_b',
          product_id: 'pro_01',
          status: 'past_due',
          grace_started_at: '2026-10-05T00:00:00Z',
        },
        {
          subscription_id: 'sub_c',
          product_id: 'pro_02',
          status: 'past_due',
          grace_started_at: '2026-10-09T00:00:00Z',
        },
      ],
    };
  });

  it('reads no licence or GitHub link', async () => {
    await getBillingView(paddle);

    expect(tablesRead()).toEqual(new Set(['active_subscriptions', 'subscriptions']));
  });

  it('says when grace ends for a customer whose subscriptions are all past due', async () => {
    await expect(getBillingView(paddle)).resolves.toMatchObject({
      access: { status: 'grace', grace: { endsAt: '2026-11-04T00:00:00.000Z', ended: false } },
    });
  });

  it('says when grace has ended but access has not been removed yet', async () => {
    vi.setSystemTime(new Date('2026-11-04T01:00:00Z'));

    await expect(getBillingView(paddle)).resolves.toMatchObject({ access: { grace: { ended: true } } });
  });

  it('agrees with access about a past-due subscription with no recorded grace start: its grace has ended', async () => {
    state.tables.subscriptions = {
      list: [{ subscription_id: 'sub_a', product_id: 'pro_01', status: 'past_due', grace_started_at: null }],
    };

    await expect(getBillingView(paddle)).resolves.toMatchObject({ access: { status: 'grace', grace: null } });
  });

  it('has no grace for an active customer', async () => {
    state.tables.active_subscriptions = access('active');

    await expect(getBillingView(paddle)).resolves.toMatchObject({ access: { status: 'active', grace: null } });
  });

  it('shows billing to a former customer, and to one whose access was never recorded', async () => {
    state.tables.active_subscriptions = access('lapsed');
    await expect(getBillingView(paddle)).resolves.toMatchObject({
      noSubscription: false,
      access: { status: 'lapsed', grace: null },
    });

    state.tables.active_subscriptions = {};
    await expect(getBillingView(paddle)).resolves.toMatchObject({ noSubscription: false, access: null });
  });

  describe('subscriptions', () => {
    const subscription = (id: string, extra: Record<string, unknown> = {}) => ({
      subscription_id: id,
      status: 'active',
      price_id: 'pri_unknown',
      product_id: 'pro_01',
      scheduled_change_at: null,
      scheduled_change_action: null,
      current_period_ends_at: { sub_renews: '2026-11-01T00:00:00Z', sub_ends: '2026-11-15T00:00:00Z' }[id] ?? null,
      grace_started_at: null,
      ...extra,
    });

    it('says when each Pro subscription renews, or when a scheduled cancellation ends it', async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews'),
          subscription('sub_ends', { scheduled_change_at: '2026-11-15T00:00:00Z', scheduled_change_action: 'cancel' }),
        ],
      };

      await expect(getBillingView(paddle)).resolves.toMatchObject({
        subscriptions: [
          { id: 'sub_renews', status: 'active', renewsAt: '2026-11-01T00:00:00Z', endsAt: null },
          { id: 'sub_ends', renewsAt: null, endsAt: '2026-11-15T00:00:00Z' },
        ],
      });
    });

    it('does not call another scheduled change an ending', async () => {
      state.tables.subscriptions = {
        list: [
          subscription('sub_renews', { scheduled_change_at: '2026-11-01T00:00:00Z', scheduled_change_action: 'pause' }),
        ],
      };

      await expect(getBillingView(paddle)).resolves.toMatchObject({
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

      await expect(getBillingView(paddle)).resolves.toMatchObject({
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
          subscription('sub_renews', { status: 'canceled' }),
          subscription('sub_other', { product_id: 'pro_other' }),
        ],
      };

      await expect(getBillingView(paddle)).resolves.toMatchObject({ subscriptions: [] });
    });
  });
});
