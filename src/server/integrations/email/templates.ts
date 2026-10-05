import 'server-only';
import { EmailMessage } from '@/server/integrations/email/send';
import { feedUrl } from '@/lib/install-snippets';

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

/** Sent when a customer's access starts (their first entitled subscription): how to restore the packages. */
export function welcomeProEmail(to: string, siteUrl: string): EmailMessage {
  return {
    to,
    subject: 'Welcome to Tenantry Pro: create a feed token to install it',
    html: layout(
      `<h1 style="font-size:20px">Welcome to Tenantry Pro</h1>
<p>Thanks for subscribing. Log in to Tenantry with this email address and create a feed token on your Pro access page. NuGet sends it to the package feed, which serves the Tenantry Pro packages at <code>${feedUrl(siteUrl)}</code>.</p>
<p><a href="${siteUrl}/dashboard/pro" style="${BUTTON}">Create a feed token</a></p>
<p>The same page has your licence key. The <a href="${siteUrl}/dashboard/pro/install" style="color:#2563EB">Install page</a> has the <code>nuget.config</code> to commit next to your solution, and what to set in CI and Docker builds.</p>`,
    ),
  };
}

/**
 * Sent when a feed token is created on the Pro access page, so a token the customer did not create is noticed. It
 * names the token and its first characters, never the token itself.
 */
export function feedTokenCreatedEmail(
  to: string,
  token: { name: string; prefix: string },
  siteUrl: string,
): EmailMessage {
  return {
    to,
    subject: 'A Tenantry Pro feed token was created',
    html: layout(
      `<h1 style="font-size:20px">A feed token was created</h1>
<p>A feed token named <strong>${escapeHtml(token.name)}</strong>, starting <code>${escapeHtml(token.prefix)}</code>, was created on your Pro access page. It can restore Tenantry Pro from the package feed until it is revoked.</p>
<p>If you did not create it, revoke it now and email support@tenantry.dev.</p>
<p><a href="${siteUrl}/dashboard/pro" style="${BUTTON}">Review your feed tokens</a></p>`,
    ),
  };
}

/**
 * Sent when a grant is confirmed: paid time reaches 12 paid months in total, or an annual term is paid. Not sent as the
 * vested-through date moves forward month by month afterwards. `annualTerm` says the date is the end of an annual term
 * not over yet, whose releases are vested as they are published.
 */
export function vestingConfirmedEmail(
  to: string,
  vestedThrough: Date,
  annualTerm: boolean,
  siteUrl: string,
): EmailMessage {
  const what = annualTerm
    ? `Your annual term is paid, so every Tenantry Pro release published on or before ${longDate(vestedThrough)}, the end of the term and your vested-through date, is vested, including those published later in the term.`
    : `Your paid time has reached 12 paid months, so every Tenantry Pro release published on or before ${longDate(vestedThrough)}, your vested-through date, is now vested.`;
  const next = annualTerm
    ? "A refund, credit or chargeback of the term's payment withdraws them, even after the term. Paying for another year vests that year's releases in the same way."
    : 'Your vested-through date moves forward as further paid time is served, now or in a later subscription; between subscriptions it stays where your last paid period ended. A refund, credit or chargeback takes away the time its money paid for.';
  return {
    to,
    subject: 'Your Tenantry Pro releases are vested',
    html: layout(
      `<h1 style="font-size:20px">Your releases are vested</h1>
<p>${what} Vested releases stay licensed to you after your subscription ends, and the package feed keeps serving them to you, with every patch release of a minor version whose x.y.0 release is vested, whenever it is published.</p>
<p>${next}</p>
<p><a href="${siteUrl}/dashboard/pro" style="${BUTTON}">See your vested releases</a></p>`,
    ),
  };
}

/**
 * A grant withdrawn, as vested_entitlements records it (billing-store.ts: Grant), or the paid time's vesting taken away
 * (no reason recorded: money it relied on was returned).
 */
export interface WithdrawnGrant {
  kind: 'paid_time' | 'annual_term';
  vestedThrough: Date;
  withdrawnReason: 'refund' | 'chargeback' | null;
}

const WITHDRAWN_BECAUSE: Record<NonNullable<WithdrawnGrant['withdrawnReason']>, string> = {
  refund: 'money paid for it was refunded or credited',
  chargeback: 'a payment it relied on was charged back',
};

/** Sent when vested releases are taken away: money returned from an annual term, or that the paid time relied on. */
export function grantWithdrawnEmail(
  to: string,
  grant: WithdrawnGrant,
  vestedThrough: Date | null,
  siteUrl: string,
): EmailMessage {
  const what = grant.kind === 'annual_term' ? 'Your annual term' : 'Your paid time';
  const because = `, because ${
    grant.withdrawnReason
      ? WITHDRAWN_BECAUSE[grant.withdrawnReason]
      : 'money it relied on was refunded, credited or charged back'
  }`;
  return {
    to,
    subject: 'Your Tenantry Pro vested releases have changed',
    html: layout(
      `<h1 style="font-size:20px">Your vested releases have changed</h1>
<p>${what} no longer vests the releases published up to ${longDate(grant.vestedThrough)}${because}.</p>
<p>${
        vestedThrough
          ? `Your vested-through date is now ${longDate(vestedThrough)}: the releases published on or before it stay vested.`
          : 'No releases are vested now.'
      } While your subscription is active, the package feed still serves you every release.</p>
<p><a href="${siteUrl}/dashboard/pro" style="${BUTTON}">See your vested releases</a></p>`,
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
<p>You no longer have an active Tenantry Pro subscription, so the package feed now serves you only your vested releases: those published up to your vested-through date, and every patch release of a minor version whose x.y.0 release is vested, as the licence agreement sets out. If nothing was vested, it serves you none, and the releases you downloaded are no longer licensed to you.</p>
<p>Your licence key keeps working either way; it does not extend your licence. You can resubscribe any time, and the paid time you have kept still counts towards 12 months:</p>
<p><a href="${siteUrl}/#pricing" style="${BUTTON}">View pricing</a></p>`,
    ),
  };
}

// Text from a customer, such as a token's name, goes into the HTML only escaped.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.codePointAt(0)};`);
}

// A date as the Pro pages show it, in UTC.
function longDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
