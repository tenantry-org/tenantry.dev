import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { subscriptionEvent } from '@/utils/testing/paddle-events';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  unmarshal: vi.fn(),
  enqueueEvent: vi.fn(),
  drainInbox: vi.fn(),
}));

vi.mock('next/server', async (original) => ({ ...(await original<object>()), after: mocks.after }));
vi.mock('@/utils/paddle/get-paddle-instance', () => ({
  getPaddleInstance: () => ({ webhooks: { unmarshal: mocks.unmarshal } }),
}));
vi.mock('@/utils/webhooks/inbox', () => ({ enqueueEvent: mocks.enqueueEvent }));
vi.mock('@/utils/webhooks/worker', () => ({ drainInbox: mocks.drainInbox }));

const event = subscriptionEvent({ eventId: 'evt_1', occurredAt: '2026-09-28T10:00:00Z', status: 'active' });

function delivery(body = JSON.stringify(event), signature = 'ts=1;h1=abc') {
  return new Request('http://localhost/api/webhook', {
    method: 'POST',
    headers: signature ? { 'paddle-signature': signature } : {},
    body,
  }) as unknown as NextRequest;
}

describe('POST /api/webhook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('PADDLE_NOTIFICATION_WEBHOOK_SECRET', 'secret');
    mocks.unmarshal.mockResolvedValue({ eventId: 'evt_1' });
    mocks.enqueueEvent.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stores the event and answers before processing it, however slow processing is', async () => {
    mocks.drainInbox.mockReturnValue(new Promise(() => {})); // e.g. a GitHub call that never returns

    const response = await POST(delivery());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 200, eventName: 'subscription.updated', deduped: false });
    expect(mocks.enqueueEvent).toHaveBeenCalledWith(event);
    expect(mocks.drainInbox).not.toHaveBeenCalled();

    // Processing starts only after the response, from the callback registered with `after`.
    expect(mocks.after).toHaveBeenCalledOnce();
    void mocks.after.mock.calls[0][0]();
    expect(mocks.drainInbox).toHaveBeenCalledOnce();
  });

  it('answers a duplicate delivery without storing it again', async () => {
    mocks.enqueueEvent.mockResolvedValue(false);

    const response = await POST(delivery());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ deduped: true });
  });

  it('rejects a delivery whose signature does not verify, storing nothing', async () => {
    mocks.unmarshal.mockRejectedValue(new Error('[Paddle] Webhook signature verification failed'));

    expect((await POST(delivery())).status).toBe(400);
    expect((await POST(delivery(JSON.stringify(event), ''))).status).toBe(400);
    expect(mocks.enqueueEvent).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('fails when the event cannot be stored, so Paddle delivers it again', async () => {
    mocks.enqueueEvent.mockRejectedValue(new Error('database unavailable'));

    expect((await POST(delivery())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
