import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keepSubscription, openBillingPortal } from './billing-actions';

const paddle = vi.hoisted(() => ({
  subscriptions: { get: vi.fn(), update: vi.fn() },
  customerPortalSessions: { create: vi.fn() },
  customerId: 'ctm_mine',
  signedIn: true,
}));
vi.mock('@/utils/supabase/user-client', () => ({
  validateUserSession: async () => {
    if (!paddle.signedIn) throw new Error('You are not allowed to perform this action.');
  },
}));
vi.mock('@/utils/entitlements/get-entitlement', () => ({ getCustomerId: async () => paddle.customerId }));
vi.mock('@/utils/paddle/get-paddle-instance', () => ({
  getPaddleInstance: () => ({
    subscriptions: paddle.subscriptions,
    customerPortalSessions: paddle.customerPortalSessions,
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const cancelScheduled = { action: 'cancel', effectiveAt: '2026-10-29T00:00:00Z', resumeAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  paddle.customerId = 'ctm_mine';
  paddle.signedIn = true;
  paddle.subscriptions.get.mockImplementation(async (id: string) => ({
    id,
    customerId: id === 'sub_mine' ? 'ctm_mine' : 'ctm_someone_else',
    status: 'active',
    scheduledChange: cancelScheduled,
  }));
  paddle.subscriptions.update.mockResolvedValue({ id: 'sub_mine', status: 'active', scheduledChange: null });
  paddle.customerPortalSessions.create.mockImplementation(async (_customer: string, ids: string[]) => ({
    id: 'cpls_1',
    customerId: 'ctm_mine',
    urls: {
      general: { overview: 'https://portal/overview' },
      subscriptions: ids.map((id) => ({
        id,
        cancelSubscription: `https://portal/cancel/${id}`,
        updateSubscriptionPaymentMethod: `https://portal/payment/${id}`,
      })),
    },
  }));
});

describe('openBillingPortal', () => {
  it("opens the signed-in customer's portal, and only returns the link", async () => {
    await expect(openBillingPortal({ kind: 'overview' })).resolves.toEqual({ url: 'https://portal/overview' });
    expect(paddle.customerPortalSessions.create).toHaveBeenCalledWith('ctm_mine', []);
  });

  it("links straight to cancelling or updating the payment method of the customer's own subscription", async () => {
    await expect(openBillingPortal({ kind: 'cancel', subscriptionId: 'sub_mine' })).resolves.toEqual({
      url: 'https://portal/cancel/sub_mine',
    });
    await expect(openBillingPortal({ kind: 'payment-method', subscriptionId: 'sub_mine' })).resolves.toEqual({
      url: 'https://portal/payment/sub_mine',
    });
    expect(paddle.customerPortalSessions.create).toHaveBeenCalledWith('ctm_mine', ['sub_mine']);
  });

  it("refuses another customer's subscription", async () => {
    await expect(openBillingPortal({ kind: 'cancel', subscriptionId: 'sub_theirs' })).resolves.toEqual({
      error: 'Subscription not found',
    });
    expect(paddle.customerPortalSessions.create).not.toHaveBeenCalled();
  });

  it('refuses a login with no customer, and no session', async () => {
    paddle.customerId = '';
    await expect(openBillingPortal({ kind: 'overview' })).resolves.toMatchObject({ error: expect.any(String) });

    paddle.customerId = 'ctm_mine';
    paddle.signedIn = false;
    await expect(openBillingPortal({ kind: 'overview' })).resolves.toMatchObject({ error: expect.any(String) });
    expect(paddle.customerPortalSessions.create).not.toHaveBeenCalled();
  });

  it('reports a Paddle failure without detail', async () => {
    paddle.customerPortalSessions.create.mockRejectedValue(new Error('500 from Paddle'));
    await expect(openBillingPortal({ kind: 'overview' })).resolves.toEqual({
      error: 'Billing is unavailable right now, please try again later',
    });
  });
});

describe('keepSubscription', () => {
  it('removes the scheduled cancellation from your own subscription', async () => {
    await expect(keepSubscription('sub_mine')).resolves.toEqual({ kept: true });
    expect(paddle.subscriptions.update).toHaveBeenCalledWith('sub_mine', { scheduledChange: null });
  });

  it("refuses another customer's subscription, and a signed-in user who is not a customer", async () => {
    await expect(keepSubscription('sub_theirs')).resolves.toEqual({ error: 'Subscription not found' });

    paddle.customerId = '';
    await expect(keepSubscription('sub_mine')).resolves.toEqual({ error: 'Subscription not found' });
    expect(paddle.subscriptions.update).not.toHaveBeenCalled();
  });

  it('changes nothing unless a cancellation is scheduled', async () => {
    for (const subscription of [
      { status: 'active', scheduledChange: null },
      { status: 'active', scheduledChange: { ...cancelScheduled, action: 'pause' } },
      { status: 'canceled', scheduledChange: cancelScheduled },
    ]) {
      paddle.subscriptions.get.mockResolvedValueOnce({ id: 'sub_mine', customerId: 'ctm_mine', ...subscription });
      await expect(keepSubscription('sub_mine')).resolves.toEqual({
        error: 'This subscription is not scheduled to cancel',
      });
    }
    expect(paddle.subscriptions.update).not.toHaveBeenCalled();
  });
});
