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

  it('runs a reconcile job in the inbox with the reconciler instead of the Paddle processor', async () => {
    const reconciler = vi.fn().mockResolvedValue({ access: 'ended' });
    const job: InboxEvent = {
      eventId: 'reconcile_ctm_1_2026-10-31T04:00:00.000Z',
      eventType: 'tenantry.reconcile_customer',
      customerId: 'ctm_1',
      attempts: 1,
      payload: {
        event_id: 'reconcile_ctm_1_2026-10-31T04:00:00.000Z',
        event_type: 'tenantry.reconcile_customer',
        occurred_at: '2026-10-31T04:00:00.000Z',
        data: { customer_id: 'ctm_1' },
      },
    };
    inbox.claimEvents.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);

    await expect(drainInbox({ processor, reconciler })).resolves.toEqual({ processed: 1, retrying: 0, failed: 0 });
    expect(reconciler).toHaveBeenCalledWith('ctm_1');
    expect(processor.processEvent).not.toHaveBeenCalled();
    expect(inbox.completeEvent).toHaveBeenCalledWith(job.eventId);

    // A failing job is retried like any event.
    reconciler.mockRejectedValueOnce(new Error('GitHub unavailable'));
    inbox.claimEvents.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
    await expect(drainInbox({ processor, reconciler })).resolves.toEqual({ processed: 0, retrying: 1, failed: 0 });
  });
});
