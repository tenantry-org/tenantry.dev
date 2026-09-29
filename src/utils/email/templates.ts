import { EmailMessage } from '@/utils/email/send';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tenantry.dev';

// Brand colours (branding/tenantry-brand-sheet.svg): navy text, slate secondary text, blue actions. The logo is a
// PNG served by the site, since mail clients do not reliably show SVG.
const BUTTON =
  'display:inline-block;background:#2563EB;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600';

function layout(body: string): string {
  return `<div style="font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#0F172A;line-height:1.55">
<p style="margin:0 0 24px"><img src="${SITE_URL}/brand/tenantry-logo.png" width="140" height="33" alt="Tenantry" style="display:block;border:0" /></p>
${body}
<hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0" />
<p style="color:#64748B;font-size:12px">Tenantry · multi-tenancy for .NET · <a href="${SITE_URL}" style="color:#2563EB">tenantry.dev</a></p>
</div>`;
}

/** Sent when a customer's access starts (their first entitled subscription). Points them at the Pro access page. */
export function welcomeProEmail(to: string): EmailMessage {
  return {
    to,
    subject: 'Welcome to Tenantry Pro — connect GitHub to get access',
    html: layout(
      `<h1 style="font-size:20px">Welcome to Tenantry Pro 🎉</h1>
<p>Thanks for subscribing. One step to unlock everything:</p>
<p><strong>Connect your GitHub account</strong> so we can give you access to the private package feed.</p>
<p><a href="${SITE_URL}/dashboard/pro" style="${BUTTON}">Open your Pro dashboard</a></p>
<p>From there you can copy your licence key and the <code>nuget.config</code> to start restoring packages.</p>`,
    ),
  };
}

/** Sent when a customer's access ends: none of their subscriptions entitles them any more. */
export function accessRevokedEmail(to: string): EmailMessage {
  return {
    to,
    subject: 'Your Tenantry Pro subscription has ended',
    html: layout(
      `<h1 style="font-size:20px">Your Tenantry Pro access has ended</h1>
<p>You no longer have an active Tenantry Pro subscription, so your access to the private package feed has been removed.</p>
<p>The versions of Tenantry Pro you already have keep working with your licence key, as the licence agreement allows, but you won't receive new versions. You can resubscribe any time:</p>
<p><a href="${SITE_URL}/#pricing" style="${BUTTON}">View pricing</a></p>`,
    ),
  };
}
