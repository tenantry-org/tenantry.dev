import 'server-only';
import { EmailMessage } from '@/server/integrations/email/send';

// The public site, for the logo and the footer: the same in every environment, since mail clients cannot reach a
// preview deployment behind Vercel Authentication. Links into the app go to the environment's own site (`siteUrl`).
const PUBLIC_SITE = 'https://tenantry.dev';

// Brand colours (branding/tenantry-brand-sheet.svg): navy text, slate secondary text, blue actions. The logo is a
// PNG served by the site, since mail clients do not reliably show SVG.
const BUTTON =
  'display:inline-block;background:#2563EB;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600';

function layout(body: string): string {
  return `<div style="font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#0F172A;line-height:1.55">
<p style="margin:0 0 24px"><img src="${PUBLIC_SITE}/brand/tenantry-logo.png" width="140" height="33" alt="Tenantry" style="display:block;border:0" /></p>
${body}
<hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0" />
<p style="color:#64748B;font-size:12px">Tenantry · multi-tenancy for .NET · <a href="${PUBLIC_SITE}" style="color:#2563EB">tenantry.dev</a></p>
</div>`;
}

/** Sent when a customer's access starts (their first entitled subscription). Points them at the Pro access page. */
export function welcomeProEmail(to: string, siteUrl: string): EmailMessage {
  return {
    to,
    subject: 'Welcome to Tenantry Pro: connect GitHub to get access',
    html: layout(
      `<h1 style="font-size:20px">Welcome to Tenantry Pro</h1>
<p>Thanks for subscribing. Log in to Tenantry with this email address and <strong>connect your GitHub account</strong> to get the private package feed.</p>
<p><a href="${siteUrl}/dashboard/pro" style="${BUTTON}">Connect GitHub</a></p>
<p>The same page has your licence key and the <code>nuget.config</code> for restoring packages.</p>`,
    ),
  };
}

/** Sent when a customer's access ends: none of their subscriptions entitles them any more. */
export function accessRevokedEmail(to: string, siteUrl: string): EmailMessage {
  return {
    to,
    subject: 'Your Tenantry Pro subscription has ended',
    html: layout(
      `<h1 style="font-size:20px">Your Tenantry Pro access has ended</h1>
<p>You no longer have an active Tenantry Pro subscription, so your access to the private package feed has been removed.</p>
<p>The versions of Tenantry Pro you already have keep working with your licence key, as the licence agreement allows, but you won't receive new versions. You can resubscribe any time:</p>
<p><a href="${siteUrl}/#pricing" style="${BUTTON}">View pricing</a></p>`,
    ),
  };
}
