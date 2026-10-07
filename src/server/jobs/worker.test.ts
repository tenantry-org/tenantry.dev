import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '@/server/db/customer-jobs';
import { drainJobs, LOCK_SECONDS } from './worker';
import { customerEvent, subscriptionEvent } from '@/test/paddle-events';

const queue = vi.hoisted(() => ({
  claimJobs: vi.fn(),
  completeJob: vi.fn(),
  retryJob: vi.fn(),
  releaseWaitingJobs: vi.fn(),
}));
vi.mock('@/server/db/customer-jobs', async (original) => ({ ...(await original<object>()), ...queue }));
const alertOperator = vi.hoisted(() => vi.fn());
vi.mock('@/server/integrations/email/alerts', () => ({ alertOperator }));

function paddleEvent(eventId: string, eventType: string, customerId: string): Job {
  const event = eventType.startsWith('customer.')
    ? customerEvent({ eventId, eventType, occurredAt: '2026-09-28T10:00:00Z', customerId, email: 'buyer@example.com' })
    : subscriptionEvent({ eventId, eventType, occurredAt: '2026-09-28T10:00:00Z', customerId, status: 'active' });

  return { id: event.notification_id, attempts: 1, kind: 'paddle_event', customerId, event };
}

describe('drainJobs', () => {
  const handlers = { applyPaddleEvent: vi.fn(), reconcileCustomer: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    queue.retryJob.mockResolvedValue('retrying');
  });

  it('runs and completes claimed jobs until none are due', async () => {
    queue.claimJobs
      .mockResolvedValueOnce([paddleEvent('evt_1', 'subscription.created', 'ctm_1')])
      .mockResolvedValueOnce([paddleEvent('evt_2', 'subscription.updated', 'ctm_1')])
      .mockResolvedValueOnce([]);

    await expect(drainJobs(handlers)).resolves.toEqual({ processed: 2, retrying: 0, failed: 0 });
    expect(handlers.applyPaddleEvent.mock.calls.map(([event]) => event.eventId)).toEqual(['evt_1', 'evt_2']);
    expect(queue.completeJob.mock.calls).toEqual([['ntf_evt_1'], ['ntf_evt_2']]);
    // Only a customer event lets the customer's waiting jobs run sooner: releasing them on every event would spend
    // their attempts without waiting out the backoff.
    expect(queue.releaseWaitingJobs).not.toHaveBeenCalled();
  });

  it('retries a job that fails, such as a subscription event whose customer is not recorded yet', async () => {
    const foreignKey = {
      code: '23503',
      message: 'violates foreign key constraint "subscriptions_customer_id_fkey"',
    };
    queue.claimJobs
      .mockResolvedValueOnce([paddleEvent('evt_1', 'subscription.created', 'ctm_1')])
      .mockResolvedValueOnce([]);
    handlers.applyPaddleEvent.mockRejectedValueOnce(foreignKey);

    await expect(drainJobs(handlers)).resolves.toEqual({ processed: 0, retrying: 1, failed: 0 });
    expect(queue.retryJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'ntf_evt_1' }), foreignKey);
    expect(queue.completeJob).not.toHaveBeenCalled();
  });

  it('alerts the operator when a job fails for good, but not while it is still retried', async () => {
    queue.claimJobs
      .mockResolvedValueOnce([paddleEvent('evt_1', 'subscription.created', 'ctm_1')])
      .mockResolvedValueOnce([]);
    handlers.applyPaddleEvent.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(drainJobs(handlers)).resolves.toEqual({ processed: 0, retrying: 1, failed: 0 });
    expect(alertOperator).not.toHaveBeenCalled();

    queue.retryJob.mockResolvedValueOnce('failed');
    queue.claimJobs
      .mockResolvedValueOnce([paddleEvent('evt_1', 'subscription.created', 'ctm_1')])
      .mockResolvedValueOnce([]);
    handlers.applyPaddleEvent.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(drainJobs(handlers)).resolves.toEqual({ processed: 0, retrying: 0, failed: 1 });
    expect(alertOperator).toHaveBeenCalledOnce();
    expect(alertOperator).toHaveBeenCalledWith(
      'Job ntf_evt_1 failed for good',
      expect.stringContaining('(Paddle event subscription.created, customer ctm_1)'),
    );
    expect(alertOperator.mock.calls[0][1]).toContain('GitHub unavailable');
  });

  it("makes a customer's waiting jobs due once the customer is recorded", async () => {
    queue.claimJobs
      .mockResolvedValueOnce([paddleEvent('evt_0', 'customer.created', 'ctm_1')])
      .mockResolvedValueOnce([]);

    await drainJobs(handlers);

    expect(queue.releaseWaitingJobs).toHaveBeenCalledWith('ctm_1');
  });

  it('stops claiming 30 seconds after it starts when given no deadline', async () => {
    let clock = 100_000;
    queue.claimJobs.mockImplementation(async () => {
      clock += 20_000;
      return [paddleEvent(`evt_${clock}`, 'subscription.updated', 'ctm_1')];
    });

    const result = await drainJobs(handlers, { now: () => clock });

    expect(result.processed).toBe(2);
    expect(queue.claimJobs).toHaveBeenCalledTimes(2);
  });

  it('starts no job after its deadline, however many are due', async () => {
    let clock = 0;
    // Each claim hands over as many jobs as asked for.
    queue.claimJobs.mockImplementation(async (limit: number) =>
      Array.from({ length: limit }, (_, n) => paddleEvent(`evt_${clock}_${n}`, 'subscription.updated', `ctm_${n}`)),
    );
    handlers.applyPaddleEvent.mockImplementation(async () => {
      clock += 20_000;
    });

    const result = await drainJobs(handlers, { deadline: 45_000, now: () => clock });

    expect(result.processed).toBe(3);
    expect(queue.claimJobs.mock.calls).toEqual([
      [1, LOCK_SECONDS],
      [1, LOCK_SECONDS],
      [1, LOCK_SECONDS],
    ]);
  });

  it('runs a reconcile job as a reconcile, not as a Paddle event', async () => {
    handlers.reconcileCustomer.mockResolvedValue({ access: 'ended' });
    const job: Job = {
      id: 'reconcile_ctm_1_2026-10-31T04:00:00.000Z',
      attempts: 1,
      kind: 'reconcile',
      customerId: 'ctm_1',
    };
    queue.claimJobs.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);

    await expect(drainJobs(handlers)).resolves.toEqual({ processed: 1, retrying: 0, failed: 0 });
    expect(handlers.reconcileCustomer).toHaveBeenCalledWith('ctm_1');
    expect(handlers.applyPaddleEvent).not.toHaveBeenCalled();
    expect(queue.completeJob).toHaveBeenCalledWith(job.id);

    // A failing reconcile is retried like any job, and named in the log.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    handlers.reconcileCustomer.mockRejectedValueOnce(new Error('GitHub unavailable'));
    queue.claimJobs.mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
    await expect(drainJobs(handlers)).resolves.toEqual({ processed: 0, retrying: 1, failed: 0 });
    expect(warn).toHaveBeenCalledWith(`Job ${job.id} (reconcile) will be retried:`, expect.any(Error));
  });
});
