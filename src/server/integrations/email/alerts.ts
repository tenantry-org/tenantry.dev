import 'server-only';
import { serverConfig } from '@/server/config/server-config';
import { sendEmail } from '@/server/integrations/email/send';

/**
 * Tells the operator about a failure that needs them. Always logged; also emailed to `ALERT_EMAIL` when it
 * is set (it is required in production). Never throws.
 */
export async function alertOperator(subject: string, detail: string, config = serverConfig()): Promise<void> {
  console.error(`ALERT: ${subject}. ${detail}`);

  if (!config.alertEmail) return;

  await sendEmail(
    { to: config.alertEmail, subject: `[Tenantry alert] ${subject}`, html: `<p>${escapeHtml(detail)}</p>` },
    config.email,
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.codePointAt(0)};`);
}
