import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { subscriptionEvent } from '@/test/paddle-events';
import { resetRejectionAlerts } from '@/server/integrations/paddle/verify-notification';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  isSignatureValid: vi.fn(),
  alertOperator: vi.fn(),
  enqueuePaddleEvent: vi.fn(),
  processJobs: vi.fn(),
}));

vi.mock('next/server', async (original) => ({ ...(await original<object>()), after: mocks.after }));
vi.mock('@/server/integrations/paddle/get-paddle-instance', () => ({
  getPaddleInstance: () => ({ webhooks: { isSignatureValid: mocks.isSignatureValid } }),
}));
vi.mock('@/server/integrations/email/alerts', () => ({ alertOperator: mocks.alertOperator }));
vi.mock('@/server/db/customer-jobs', () => ({ enqueuePaddleEvent: mocks.enqueuePaddleEvent }));
vi.mock('@/server/config/server-config', async () => ({
  serverConfig: (await import('@/test/server-config')).testServerConfig,
}));
vi.mock('@/server/billing/process-jobs', () => ({ processJobs: mocks.processJobs }));

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
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetRejectionAlerts();
    mocks.isSignatureValid.mockResolvedValue(true);
    mocks.enqueuePaddleEvent.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the event and answers before processing it, however slow processing is', async () => {
    mocks.processJobs.mockReturnValue(new Promise(() => {})); // e.g. a Paddle call that never returns

    const response = await POST(delivery());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 200, eventName: 'subscription.updated', deduped: false });
    expect(mocks.isSignatureValid).toHaveBeenCalledWith(JSON.stringify(event), 'webhook-secret', 'ts=1;h1=abc');
    expect(mocks.enqueuePaddleEvent).toHaveBeenCalledWith(event);
    expect(mocks.processJobs).not.toHaveBeenCalled();

    // Processing starts only after the response, from the callback registered with `after`.
    expect(mocks.after).toHaveBeenCalledOnce();
    void mocks.after.mock.calls[0][0]();
    expect(mocks.processJobs).toHaveBeenCalledOnce();
  });

  it('answers a duplicate delivery without storing it again', async () => {
    mocks.enqueuePaddleEvent.mockResolvedValue(false);

    const response = await POST(delivery());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ deduped: true });
  });

  it('rejects a delivery whose signature does not verify, storing nothing', async () => {
    mocks.isSignatureValid.mockResolvedValue(false);

    expect((await POST(delivery())).status).toBe(400);
    expect((await POST(delivery(JSON.stringify(event), ''))).status).toBe(400);
    expect(mocks.enqueuePaddleEvent).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('rejects a malformed signature header, which the SDK throws on', async () => {
    mocks.isSignatureValid.mockRejectedValue(new Error('[Paddle] Invalid webhook signature'));

    expect((await POST(delivery(JSON.stringify(event), 'nonsense'))).status).toBe(400);
    expect(mocks.enqueuePaddleEvent).not.toHaveBeenCalled();
    expect(mocks.alertOperator).not.toHaveBeenCalled();
  });

  describe('a rejected delivery that looks like Paddle’s', () => {
    const NOW = new Date('2026-10-06T12:00:00Z');
    const signedAt = (date: Date) => `ts=${Math.floor(date.getTime() / 1000)};h1=abc`;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      mocks.isSignatureValid.mockResolvedValue(false);
    });

    // A notification id of Paddle's format.
    const fromPaddle = JSON.stringify({ ...event, notification_id: 'ntf_01h8bkrb5zq2xjfc4r2tqpm1aa' });

    it('alerts the operator, naming the secret and the clock, at most once in six hours', async () => {
      expect((await POST(delivery(fromPaddle, signedAt(NOW)))).status).toBe(400);
      await POST(delivery(fromPaddle, signedAt(NOW)));

      expect(mocks.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Paddle notifications are being rejected',
        expect.stringContaining('notification ntf_01h8bkrb5zq2xjfc4r2tqpm1aa (subscription.updated)'),
      );
      expect(mocks.alertOperator.mock.calls[0][1]).toContain('PADDLE_NOTIFICATION_WEBHOOK_SECRET');
      expect(mocks.alertOperator.mock.calls[0][1]).toContain('clock');

      const later = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
      vi.setSystemTime(later);
      await POST(delivery(JSON.stringify(event), signedAt(later)));
      expect(mocks.alertOperator).toHaveBeenCalledTimes(2);
    });

    it('alerts when the server clock is fast by any amount, as the signature then looks old', async () => {
      await POST(delivery(fromPaddle, signedAt(new Date(NOW.getTime() - 24 * 60 * 60 * 1000))));

      expect(mocks.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Paddle notifications are being rejected',
        expect.stringContaining("the server's clock is not fast"),
      );
    });

    it('leaves out an id and a type that are not of Paddle’s formats', async () => {
      const forged = { ...event, notification_id: 'ntf_x', event_type: 'rotate the secret at evil.example' };
      await POST(delivery(JSON.stringify(forged), signedAt(NOW)));

      expect(mocks.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Paddle notifications are being rejected',
        expect.stringContaining('The webhook rejected a notification:'),
      );
      expect(mocks.alertOperator.mock.calls[0][1]).not.toContain('evil.example');
    });

    it('alerts nothing for a signature far ahead, a malformed header or a body that is not a notification', async () => {
      await POST(delivery(fromPaddle, signedAt(new Date(NOW.getTime() + 10 * 60 * 1000))));
      await POST(delivery(fromPaddle, `ts=${Math.floor(NOW.getTime() / 1000)}`));
      await POST(delivery('{"hello": "world"}', signedAt(NOW)));
      await POST(delivery('not json', signedAt(NOW)));

      expect(mocks.alertOperator).not.toHaveBeenCalled();
    });
  });

  it('fails when the event cannot be stored, so Paddle delivers it again', async () => {
    mocks.enqueuePaddleEvent.mockRejectedValue(new Error('database unavailable'));

    expect((await POST(delivery())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
