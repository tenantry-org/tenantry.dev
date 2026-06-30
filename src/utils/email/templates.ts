import { EmailMessage } from '@/utils/email/send';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tenantry.dev';

function layout(body: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.5">
${body}
<hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
<p style="color:#888;font-size:12px">Tenantry · multi-tenancy for .NET · <a href="${SITE_URL}" style="color:#888">tenantry.dev</a></p>
</div>`;
}

/** Sent once when a subscription becomes active. Points the customer at the Pro access page. */
export function welcomeProEmail(to: string): EmailMessage {
  return {
    to,
    subject: 'Welcome to Tenantry Pro — connect GitHub to get access',
    html: layout(
      `<h1 style="font-size:20px">Welcome to Tenantry Pro 🎉</h1>
<p>Thanks for subscribing. One step to unlock everything:</p>
<p><strong>Connect your GitHub account</strong> so we can add you to the private repository and package feed.</p>
<p><a href="${SITE_URL}/dashboard/pro" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open your Pro dashboard</a></p>
<p>From there you can copy your licence key and the <code>nuget.config</code> to start restoring packages.</p>`,
    ),
  };
}

/** Sent when a subscription is canceled and access is being revoked. */
export function accessRevokedEmail(to: string): EmailMessage {
  return {
    to,
    subject: 'Your Tenantry Pro subscription has ended',
    html: layout(
      `<h1 style="font-size:20px">Your Tenantry Pro access has ended</h1>
<p>Your subscription was canceled, so access to the private repository and package feed has been removed.</p>
<p>Already-installed builds keep working, but you won't receive new Pro package versions. You can resubscribe any time:</p>
<p><a href="${SITE_URL}/#pricing" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">View pricing</a></p>`,
    ),
  };
}
