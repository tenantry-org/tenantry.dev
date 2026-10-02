import { NextRequest, after } from 'next/server';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';
import { enqueuePaddleEvent, PaddleEventJson } from '@/server/db/customer-jobs';
import { processJobs } from '@/server/billing/process-jobs';
import { serverConfig } from '@/server/config/server-config';

// Processing runs after the response (see `after` below), within this function's time limit.
export const maxDuration = 60;

// Paddle delivers notifications here and expects an answer within 5 seconds. The signature is verified
// with the destination secret, the event is stored as a customer job (a duplicate delivery changes nothing),
// and the response goes out. The due jobs then run after the response; the reconcile cron runs them too, so an
// event that fails is retried even if Paddle sends nothing more.
export async function POST(request: NextRequest) {
  const signature = request.headers.get('paddle-signature') || '';
  const rawRequestBody = await request.text();
  const secret = serverConfig().paddle.webhookSecret;

  if (!signature || !rawRequestBody) {
    return Response.json({ error: 'Missing signature from header' }, { status: 400 });
  }

  try {
    await getPaddleInstance().webhooks.unmarshal(rawRequestBody, secret, signature);
  } catch (error) {
    console.warn('Paddle webhook: signature verification failed:', error);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const event = JSON.parse(rawRequestBody) as PaddleEventJson;
    const stored = await enqueuePaddleEvent(event);

    after(async () => {
      try {
        await processJobs();
      } catch (error) {
        console.error('Paddle webhook: running the jobs failed; the reconcile cron will retry:', error);
      }
    });

    return Response.json({ status: 200, eventName: event.event_type, deduped: !stored });
  } catch (error) {
    // Not stored: a 500 makes Paddle deliver it again.
    console.error('Paddle webhook: storing the event failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
