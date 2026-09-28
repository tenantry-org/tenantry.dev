import { sendEmail } from '@/utils/email/send';

/**
 * Tells the operator about a failure that needs them. Always logged; also emailed to `ALERT_EMAIL` when it
 * is set (it is required in production). Never throws.
 */
export async function alertOperator(subject: string, detail: string): Promise<void> {
  console.error(`ALERT: ${subject}. ${detail}`);

  const to = process.env.ALERT_EMAIL?.trim();
  if (!to) return;

  await sendEmail({
    to,
    subject: `[Tenantry alert] ${subject}`,
    html: `<p>${escapeHtml(detail)}</p>`,
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.codePointAt(0)};`);
}
