import { NextRequest } from 'next/server';
import { ProcessWebhook } from '@/utils/paddle/process-webhook';
import { getPaddleInstance } from '@/utils/paddle/get-paddle-instance';
import { hasProcessed, markProcessed } from '@/utils/webhooks/idempotency';

const webhookProcessor = new ProcessWebhook();

// Paddle delivers notifications here. The signature is verified with the destination secret before
// any processing; unmarshal() rejects tampered/replayed payloads. Already-seen event ids are skipped
// (Paddle retries at least once); successful events are recorded so duplicates are no-ops.
export async function POST(request: NextRequest) {
  const signature = request.headers.get('paddle-signature') || '';
  const rawRequestBody = await request.text();
  const privateKey = process.env['PADDLE_NOTIFICATION_WEBHOOK_SECRET'] || '';

  try {
    if (!signature || !rawRequestBody) {
      return Response.json({ error: 'Missing signature from header' }, { status: 400 });
    }

    const paddle = getPaddleInstance();
    const eventData = await paddle.webhooks.unmarshal(rawRequestBody, privateKey, signature);
    const eventName = eventData?.eventType ?? 'Unknown event';

    if (eventData) {
      if (await hasProcessed(eventData.eventId)) {
        return Response.json({ status: 200, eventName, deduped: true });
      }

      await webhookProcessor.processEvent(eventData);
      await markProcessed(eventData.eventId, eventData.eventType);
    }

    return Response.json({ status: 200, eventName });
  } catch (e) {
    // 500 → Paddle retries. The event id is recorded only on success, so a retry reprocesses cleanly.
    console.error('Paddle webhook processing failed:', e);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
