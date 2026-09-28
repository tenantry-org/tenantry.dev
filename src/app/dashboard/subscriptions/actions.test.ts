import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelSubscription } from './actions';
import { getSubscription } from '@/utils/paddle/get-subscription';

const paddle = vi.hoisted(() => ({
  subscriptions: { get: vi.fn(), cancel: vi.fn() },
  customerId: 'ctm_mine',
}));
vi.mock('@/utils/supabase/server', () => ({ validateUserSession: vi.fn() }));
vi.mock('@/utils/paddle/get-customer-id', () => ({ getCustomerId: async () => paddle.customerId }));
vi.mock('@/utils/paddle/get-paddle-instance', () => ({
  getPaddleInstance: () => ({ subscriptions: paddle.subscriptions }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

describe('subscription ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paddle.customerId = 'ctm_mine';
    paddle.subscriptions.get.mockImplementation(async (id: string) => ({
      id,
      customerId: id === 'sub_mine' ? 'ctm_mine' : 'ctm_someone_else',
      status: 'active',
    }));
    paddle.subscriptions.cancel.mockResolvedValue({ id: 'sub_mine', status: 'active' });
  });

  it("refuses to cancel another customer's subscription", async () => {
    await expect(cancelSubscription('sub_theirs')).resolves.toEqual({ error: 'Subscription not found' });
    expect(paddle.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('cancels your own at the end of the billing period', async () => {
    await expect(cancelSubscription('sub_mine')).resolves.toMatchObject({ id: 'sub_mine' });
    expect(paddle.subscriptions.cancel).toHaveBeenCalledWith('sub_mine', { effectiveFrom: 'next_billing_period' });
  });

  it('refuses a signed-in user who is not a customer', async () => {
    paddle.customerId = '';
    await expect(cancelSubscription('sub_mine')).resolves.toEqual({ error: 'Subscription not found' });
    expect(paddle.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("does not show another customer's subscription", async () => {
    await expect(getSubscription('sub_theirs')).resolves.toMatchObject({ error: expect.any(String) });
    await expect(getSubscription('sub_mine')).resolves.toMatchObject({
      data: expect.objectContaining({ id: 'sub_mine' }),
    });
  });
});
