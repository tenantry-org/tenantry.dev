import 'server-only';

/**
 * Minimal transactional email via Resend's REST API (no SDK dependency).
 *
 * Resilient by design: if `RESEND_API_KEY` is not configured the send is logged and skipped rather
 * than throwing, so the webhook keeps working before email is wired up. Purchase *receipts* are sent
 * by Paddle (merchant of record); these are onboarding / lifecycle notices only.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

const DEFAULT_FROM = 'Tenantry <noreply@tenantry.dev>';

/**
 * The request Resend is sent. The sender is a no-reply address, so replies go to `EMAIL_REPLY_TO` (support)
 * when it is set; it is required in production (server-config.ts).
 */
export function resendRequest(message: EmailMessage, env: Record<string, string | undefined> = process.env) {
  const replyTo = env.EMAIL_REPLY_TO?.trim();

  return {
    from: env.EMAIL_FROM ?? DEFAULT_FROM,
    ...(replyTo ? { reply_to: replyTo } : {}),
    to: message.to,
    subject: message.subject,
    html: message.html,
  };
}

/** Sends an email. Returns true if dispatched, false if skipped/failed (never throws). */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(`Email skipped (RESEND_API_KEY not set): "${message.subject}" → ${message.to}`);
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendRequest(message)),
    });

    if (!response.ok) {
      console.error(`Email send failed (${response.status}): ${await response.text()}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email send threw:', error);
    return false;
  }
}
