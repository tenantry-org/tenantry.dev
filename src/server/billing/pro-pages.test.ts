import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import { testServerConfig } from '@/test/server-config';
import { getAccessView, getBillingView, getInstallView, readEntitlement } from './pro-pages';

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

/** active_subscriptions as stored: access, the grace end in grace, and the paid time. */
const stored = (status: string, extra: { grace_ends_at?: string; months_paid?: number; vests_at?: string } = {}) => ({
  single: {
    access_status: status,
    grace_ends_at: null,
    months_paid: 0,
    vests_at: null,
    ...extra,
  },
});
/** The customer's latest confirmed grant: its vested-through date, from an operator grant unless another kind is given. */
const vested = (through: string | null, kind = 'operator') => ({
  single: through ? { vested_through: through, kind } : null,
});

// The tables a read model read, besides the customer lookup.
const tablesRead = () => new Set(state.calls.map(({ table }) => table).filter((table) => table !== 'customers'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
  state.user = BUYER;
  state.calls.length = 0;
  state.tables = {
    customers: { single: { customer_id: 'ctm_1' } },
    active_subscriptions: stored('active', { months_paid: 3, vests_at: '2027-07-01T00:00:00Z' }),
    vested_entitlements: vested(null),
    feed_tokens: {
      list: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'CI',
          prefix: 'tpf_ab12',
          created_at: '2026-10-01T09:00:00Z',
          last_used_at: null,
        },
      ],
    },
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

    await expect(view()).resolves.toEqual({ noSubscription: true, customer: false, accountEmail: 'buyer@example.com' });
    expect(tablesRead()).toEqual(new Set());
  });
});

describe('readEntitlement', () => {
  it('gives an active customer every release, with the progress of their paid time', async () => {
    await expect(readEntitlement('ctm_1')).resolves.toEqual({
      access: 'active',
      graceEndsAt: null,
      canRestore: true,
      vestedThrough: null,
      paidTime: { monthsPaid: 3, vestsAt: '2027-07-01T00:00:00.000Z', reached: false },
      annualTerm: false,
    });
  });

  it('says whether the paid time has reached 12 months by now, not only whether 12 months are paid', async () => {
    state.tables.active_subscriptions = stored('active', { months_paid: 12, vests_at: '2027-07-01T00:00:00Z' });

    await expect(readEntitlement('ctm_1', new Date('2027-06-15T00:00:00Z'))).resolves.toMatchObject({
      paidTime: { monthsPaid: 12, reached: false },
    });
    state.tables.vested_entitlements = vested('2027-07-01T00:00:00Z', 'paid_time');
    await expect(readEntitlement('ctm_1', new Date('2027-07-01T00:00:00Z'))).resolves.toMatchObject({
      paidTime: { reached: true },
    });
  });

  it('does not say 12 months were reached in grace after a failed renewal, while nothing is vested', async () => {
    // Stored when the renewal failed: the estimate was the end of the period then, now passed.
    state.tables.active_subscriptions = stored('grace', {
      grace_ends_at: '2027-07-20T00:00:00Z',
      months_paid: 11,
      vests_at: '2027-07-01T00:00:00Z',
    });

    await expect(readEntitlement('ctm_1', new Date('2027-07-05T00:00:00Z'))).resolves.toMatchObject({
      access: 'grace',
      vestedThrough: null,
      paidTime: { monthsPaid: 11, reached: false },
    });
  });

  it('says when grace ends, and treats a grace period that has ended as lapsed, as the package feed does', async () => {
    state.tables.active_subscriptions = stored('grace', { grace_ends_at: '2026-11-04T00:00:00Z' });
    await expect(readEntitlement('ctm_1')).resolves.toMatchObject({
      access: 'grace',
      graceEndsAt: '2026-11-04T00:00:00.000Z',
      canRestore: true,
    });

    await expect(readEntitlement('ctm_1', new Date('2026-11-04T01:00:00Z'))).resolves.toMatchObject({
      access: 'lapsed',
      graceEndsAt: null,
      canRestore: false,
    });
  });

  it('gives a lapsed customer the vested-through date, any operator grant included, and no progress', async () => {
    state.tables.active_subscriptions = stored('lapsed');
    state.tables.vested_entitlements = vested('2027-12-31T00:00:00Z', 'annual_term');

    await expect(readEntitlement('ctm_1')).resolves.toEqual({
      access: 'lapsed',
      graceEndsAt: null,
      canRestore: true,
      vestedThrough: '2027-12-31T00:00:00.000Z',
      paidTime: null,
      annualTerm: false,
    });
    expect(state.calls).toContainEqual({ table: 'vested_entitlements', method: 'eq', args: ['status', 'confirmed'] });
    expect(state.calls).not.toContainEqual(
      expect.objectContaining({ table: 'vested_entitlements', args: ['kind', expect.anything()] }),
    );
  });

  it('gives a lapsed customer with nothing vested, or never recorded, nothing to restore', async () => {
    state.tables.active_subscriptions = stored('lapsed');
    await expect(readEntitlement('ctm_1')).resolves.toMatchObject({ access: 'lapsed', canRestore: false });

    state.tables.active_subscriptions = {};
    await expect(readEntitlement('ctm_1')).resolves.toMatchObject({ access: 'lapsed', canRestore: false });
  });

  it('says an annual term not over yet gives the vested-through date, while the customer has access', async () => {
    state.tables.active_subscriptions = stored('active', { months_paid: 12, vests_at: '2027-10-01T00:00:00Z' });
    state.tables.vested_entitlements = vested('2027-10-01T00:00:00Z', 'annual_term');
    await expect(readEntitlement('ctm_1')).resolves.toMatchObject({
      vestedThrough: '2027-10-01T00:00:00.000Z',
      annualTerm: true,
    });

    // Once the term is over, or when another grant gives the date, it is a vested-through date like any other.
    await expect(readEntitlement('ctm_1', new Date('2027-10-01T00:00:00Z'))).resolves.toMatchObject({
      annualTerm: false,
    });
    state.tables.vested_entitlements = vested('2027-10-01T00:00:00Z', 'paid_time');
    await expect(readEntitlement('ctm_1')).resolves.toMatchObject({ annualTerm: false });
  });
});

describe('getAccessView', () => {
  it('shows any customer their entitlement, live feed tokens and licence key, and reads nothing else', async () => {
    await expect(getAccessView()).resolves.toEqual({
      noSubscription: false,
      entitlement: expect.objectContaining({ access: 'active' }),
      tokens: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'CI',
          prefix: 'tpf_ab12',
          createdAt: '2026-10-01T09:00:00.000Z',
          lastUsedAt: null,
        },
      ],
      licenceKey: 'licence.key',
    });
    expect(tablesRead()).toEqual(new Set(['active_subscriptions', 'vested_entitlements', 'feed_tokens', 'licences']));
  });

  it('reads the feed tokens that are not revoked, never their hashes', async () => {
    await getAccessView();

    const tokenCalls = state.calls.filter((call) => call.table === 'feed_tokens');
    expect(tokenCalls).toContainEqual({ table: 'feed_tokens', method: 'is', args: ['revoked_at', null] });
    expect(tokenCalls).toContainEqual({ table: 'feed_tokens', method: 'eq', args: ['customer_id', 'ctm_1'] });
    expect(String(tokenCalls.find((call) => call.method === 'select')?.args[0])).not.toContain('token_hash');
  });

  it('still shows a former customer their key and tokens', async () => {
    state.tables.active_subscriptions = stored('lapsed');

    await expect(getAccessView()).resolves.toMatchObject({
      noSubscription: false,
      entitlement: { access: 'lapsed', canRestore: false },
      licenceKey: 'licence.key',
      tokens: [expect.objectContaining({ name: 'CI' })],
    });
  });
});

describe('getInstallView', () => {
  it('shows the install steps to a customer the package feed serves, and reads no licence or tokens', async () => {
    await expect(getInstallView()).resolves.toMatchObject({ noSubscription: false });
    expect(tablesRead()).toEqual(new Set(['active_subscriptions', 'vested_entitlements']));

    state.tables.active_subscriptions = stored('lapsed');
    state.tables.vested_entitlements = vested('2027-12-31T00:00:00Z');
    await expect(getInstallView()).resolves.toMatchObject({ noSubscription: false });
  });

  it('shows a former customer with nothing vested no install steps', async () => {
    state.tables.active_subscriptions = stored('lapsed');

    await expect(getInstallView()).resolves.toMatchObject({ noSubscription: true, customer: true });
  });
});

describe('getBillingView', () => {
  it('reads no licence or feed tokens, and gives the same entitlement as the Access page', async () => {
    state.tables.subscriptions = { list: [] };
    const billing = await getBillingView(paddle);
    expect(tablesRead()).toEqual(new Set(['active_subscriptions', 'vested_entitlements', 'subscriptions']));
    const access = await getAccessView();

    expect(billing).toMatchObject({ entitlement: (access as { entitlement: unknown }).entitlement });
  });

  it('shows billing to a former customer, and to one whose access was never recorded', async () => {
    state.tables.subscriptions = { list: [] };
    state.tables.active_subscriptions = stored('lapsed');
    await expect(getBillingView(paddle)).resolves.toMatchObject({
      noSubscription: false,
      entitlement: { access: 'lapsed' },
    });

    state.tables.active_subscriptions = {};
    await expect(getBillingView(paddle)).resolves.toMatchObject({
      noSubscription: false,
      entitlement: { access: 'lapsed' },
    });
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
