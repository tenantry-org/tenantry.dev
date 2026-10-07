import 'server-only';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';
import { alertOperator } from '@/server/integrations/email/alerts';

/**
 * How far ahead of now a rejected delivery's signature time may be and still look like Paddle's, which signs as it
 * sends, so a wrong secret is still reported while the server clock is a few minutes slow. A signature time in the past
 * has no limit: the SDK rejects one more than five seconds old, which is what a fast clock causes.
 */
const AHEAD_MS = 5 * 60 * 1000;
/** Paddle's notification ids and event types: anything else in a rejected body is left out of the alert. */
const NOTIFICATION_ID = /^ntf_[a-z0-9]{26}$/;
const EVENT_TYPE = /^[a-z_.]{1,64}$/;
/** How often a process alerts about rejected notifications: once per problem, not once per delivery. */
const ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastAlertAt: number | null = null;

/** Forgets when the last rejected-notification alert was sent, for tests. */
export function resetRejectionAlerts() {
  lastAlertAt = null;
}

/**
 * Whether a delivery to the webhook is signed with the notification destination's secret (the Paddle-Signature header,
 * `ts=…;h1=…`). A malformed header is rejected like a wrong signature.
 *
 * A rejected delivery that looks like one Paddle has sent alerts the operator, at most once in six hours per process:
 * its header is well formed, its signature time is no more than five minutes ahead of now, and its body is a
 * notification. A secret that no longer matches the destination, or a server clock more than five seconds fast,
 * rejects every notification, and Paddle stops retrying after a while; both are reported, however fast the clock is.
 * Other rejected requests are internet noise and alert nothing. Anyone can send a request that looks the same, so the
 * alert names the notification only when its id and type have Paddle's formats.
 */
export async function verifyNotification(body: string, signature: string, secret: string): Promise<boolean> {
  let valid: boolean;
  try {
    valid = await getPaddleInstance().webhooks.isSignatureValid(body, secret, signature);
  } catch {
    valid = false;
  }

  if (!valid) await alertIfFromPaddle(body, signature);
  return valid;
}

async function alertIfFromPaddle(body: string, signature: string) {
  const now = Date.now();
  const signedAt = signatureTime(signature);
  const notification = notificationOf(body);
  if (signedAt === null || signedAt - now > AHEAD_MS || !notification) return;
  if (lastAlertAt !== null && now - lastAlertAt < ALERT_INTERVAL_MS) return;
  lastAlertAt = now;

  await alertOperator(
    'Paddle notifications are being rejected',
    `The webhook rejected ${described(notification)}: its signature does not match ` +
      'PADDLE_NOTIFICATION_WEBHOOK_SECRET, or was made more than five seconds before the server received it. If ' +
      'Paddle sent it, every notification is being rejected. Check that the secret matches the notification ' +
      "destination in Paddle, and that the server's clock is not fast; then replay the rejected notifications from " +
      'Paddle. A forged request can look the same. No further alert is sent from this process for six hours.',
  );
}

// The signature's time in milliseconds, or null if the header is not of the form Paddle sends (a ts and an h1).
function signatureTime(header: string): number | null {
  const parts = new Map(header.split(';').map((part) => part.split('=') as [string, string | undefined]));
  const ts = Number(parts.get('ts'));
  return parts.get('h1') && Number.isSafeInteger(ts) && ts > 0 ? ts * 1000 : null;
}

// The notification's id and type, if the body is a Paddle notification.
function notificationOf(body: string): { id: string; type: string } | null {
  try {
    const { notification_id: id, event_type: type } = JSON.parse(body) as Record<string, unknown>;
    return typeof id === 'string' && typeof type === 'string' ? { id, type } : null;
  } catch {
    return null;
  }
}

// The notification as the alert names it: its id and type only if they have Paddle's formats.
function described({ id, type }: { id: string; type: string }): string {
  return NOTIFICATION_ID.test(id) && EVENT_TYPE.test(type) ? `notification ${id} (${type})` : 'a notification';
}
