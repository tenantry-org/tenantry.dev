import { describe, expect, it, vi } from 'vitest';
import type { Paddle } from '@paddle/paddle-node-sdk';
import { cancelSubscriptionNow } from './cancel-subscription';

vi.mock('@/server/integrations/paddle/get-paddle-instance', () => ({ getPaddleInstance: () => ({}) }));

function paddleWith(status: string) {
  const subscriptions = { get: vi.fn().mockResolvedValue({ status }), cancel: vi.fn().mockResolvedValue({}) };
  return { paddle: { subscriptions } as unknown as Paddle, subscriptions };
}

describe('cancelSubscriptionNow', () => {
  it('cancels an active subscription immediately', async () => {
    const { paddle, subscriptions } = paddleWith('active');

    await expect(cancelSubscriptionNow('sub_01', paddle)).resolves.toBe(true);
    expect(subscriptions.cancel).toHaveBeenCalledExactlyOnceWith('sub_01', { effectiveFrom: 'immediately' });
  });

  it('does nothing for a subscription that is already cancelled', async () => {
    const { paddle, subscriptions } = paddleWith('canceled');

    await expect(cancelSubscriptionNow('sub_01', paddle)).resolves.toBe(false);
    expect(subscriptions.cancel).not.toHaveBeenCalled();
  });
});
