import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEvent } from './inbox';
import { drainInbox } from './worker';
import { customerEvent, subscriptionEvent } from '@/utils/testing/paddle-events';

const inbox = vi.hoisted(() => ({
  claimEvents: vi.fn(),
  completeEvent: vi.fn(),
  retryEvent: vi.fn(),
  releaseWaitingEvents: vi.fn(),
}));
vi.mock('@/utils/webhooks/inbox', () => inbox);
vi.mock('@/utils/paddle/process-webhook', () => ({ ProcessWebhook: class {} }));

function inboxEvent(eventId: string, eventType: string, customerId: string): InboxEvent {
  const payload = eventType.startsWith('customer.')
    ? customerEvent({ eventId, eventType, occurredAt: '2026-09-28T10:00:00Z', customerId, email: 'buyer@example.com' })
    : subscriptionEvent({ eventId, eventType, occurredAt: '2026-09-28T10:00:00Z', customerId, status: 'active' });

  return { eventId, eventType, customerId, attempts: 1, payload };
}

describe('drainInbox', () => {
  const processor = { processEvent: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    inbox.retryEvent.mockResolvedValue('retrying');
  });

  it('processes and completes claimed events until none are due', async () => {
    inbox.claimEvents
      .mockResolvedValueOnce([inboxEvent('evt_1', 'subscription.created', 'ctm_1')])
      .mockResolvedValueOnce([inboxEvent('evt_2', 'subscription.updated', 'ctm_1')])
      .mockResolvedValueOnce([]);

    await expect(drainInbox({ processor })).resolves.toEqual({ processed: 2, retrying: 0, failed: 0 });
    expect(processor.processEvent.mock.calls.map(([event]) => event.eventId)).toEqual(['evt_1', 'evt_2']);
    expect(inbox.completeEvent.mock.calls).toEqual([['evt_1'], ['evt_2']]);
  });

  it('retries an event whose processing fails, such as a subscription whose customer is not recorded yet', async () => {
    const foreignKey = {
      code: '23503',
      message: 'violates foreign key constraint "public_subscriptions_customer_id_fkey"',
    };
    inbox.claimEvents
      .mockResolvedValueOnce([inboxEvent('evt_1', 'subscription.created', 'ctm_1')])
      .mockResolvedValueOnce([]);
    processor.processEvent.mockRejectedValueOnce(foreignKey);

    await expect(drainInbox({ processor })).resolves.toEqual({ processed: 0, retrying: 1, failed: 0 });
    expect(inbox.retryEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt_1' }), foreignKey);
    expect(inbox.completeEvent).not.toHaveBeenCalled();
  });

  it("makes a customer's waiting events due once the customer is recorded", async () => {
    inbox.claimEvents
      .mockResolvedValueOnce([inboxEvent('evt_0', 'customer.created', 'ctm_1')])
      .mockResolvedValueOnce([]);

    await drainInbox({ processor });

    expect(inbox.releaseWaitingEvents).toHaveBeenCalledWith('ctm_1');
  });

  it('stops claiming when its time budget is spent', async () => {
    let clock = 0;
    inbox.claimEvents.mockImplementation(async () => {
      clock += 20_000;
      return [inboxEvent(`evt_${clock}`, 'subscription.updated', 'ctm_1')];
    });

    const result = await drainInbox({ processor, budgetMs: 30_000, now: () => clock });

    expect(result.processed).toBe(2);
    expect(inbox.claimEvents).toHaveBeenCalledTimes(2);
  });
});
