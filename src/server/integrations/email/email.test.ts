import { afterEach, describe, expect, it, vi } from 'vitest';
import { testServerConfig } from '@/test/server-config';
import { alertOperator } from './alerts';
import { resendRequest, sendEmail } from './send';
import { accessRevokedEmail, feedTokenCreatedEmail, welcomeProEmail } from './templates';

const SITE = 'https://sandbox.example.com';
const email = { resendApiKey: 're_test', from: 'Tenantry <noreply@tenantry.dev>', replyTo: 'support@tenantry.dev' };

describe('sendEmail', () => {
  afterEach(() => {
    vi.restoreAllMocks(); // the console spy
  });

  it('skips (returns false) without throwing when email is not configured', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }, null)).resolves.toBe(false);
  });

  it('sends replies to EMAIL_REPLY_TO, from the configured no-reply sender', () => {
    const message = { to: 'cust@example.com', subject: 's', html: '<p>x</p>' };

    expect(resendRequest(message, email)).toEqual({
      from: 'Tenantry <noreply@tenantry.dev>',
      reply_to: 'support@tenantry.dev',
      ...message,
    });
    expect(resendRequest(message, { ...email, replyTo: null })).not.toHaveProperty('reply_to');
  });
});

describe('email templates', () => {
  it("welcomeProEmail targets the customer and links this environment's Pro dashboard", () => {
    const msg = welcomeProEmail('cust@example.com', SITE);

    expect(msg.to).toBe('cust@example.com');
    expect(msg.subject).toMatch(/Tenantry Pro/);
    expect(msg.html).toContain(`href="${SITE}/dashboard/pro"`);
  });

  it("welcomeProEmail gives this environment's package feed and asks for a feed token, with no GitHub step", () => {
    const { html } = welcomeProEmail('cust@example.com', SITE);

    expect(html).toContain(`<code>${SITE}/feed/v3/index.json</code>`);
    expect(html).toContain('create a feed token');
    expect(html).toContain(`href="${SITE}/dashboard/pro/install"`);
    expect(html).not.toMatch(/github/i);
  });

  it('welcomeProEmail says which account to log in with: purchases are matched to accounts by email address', () => {
    expect(welcomeProEmail('cust@example.com', SITE).html).toContain('Log in to Tenantry with this email address');
  });

  it('feedTokenCreatedEmail names the token, escaping its name, and links the access page to revoke it', () => {
    const { to, html } = feedTokenCreatedEmail(
      'cust@example.com',
      { name: '<img src=x onerror=alert(1)> & co', prefix: 'tpf_ab12' },
      SITE,
    );

    expect(to).toBe('cust@example.com');
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62; &#38; co');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<code>tpf_ab12</code>');
    expect(html).toContain(`href="${SITE}/dashboard/pro"`);
  });

  it("accessRevokedEmail targets the customer, mentions ending, and links this environment's pricing", () => {
    const msg = accessRevokedEmail('cust@example.com', SITE);

    expect(msg.to).toBe('cust@example.com');
    expect(msg.html).toMatch(/ended|removed/i);
    expect(msg.html).toContain(`href="${SITE}/#pricing"`);
  });

  it('promises only the package feed, not repository access', () => {
    // A subscription gives access to the private package feed only; neither email may claim more.
    for (const msg of [welcomeProEmail('cust@example.com', SITE), accessRevokedEmail('cust@example.com', SITE)]) {
      expect(msg.html).toContain('package feed');
      expect(msg.html).not.toMatch(/repositor|source code/i);
    }
  });
});

describe('alertOperator', () => {
  const resend = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  const sent = () => resend.mock.calls.map(([, init]) => JSON.parse(init?.body as string));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks(); // the console spy
    resend.mockClear();
  });

  function stubResend() {
    vi.stubGlobal('fetch', resend);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  }

  it('emails the operator at ALERT_EMAIL, with the detail escaped', async () => {
    stubResend();

    await alertOperator(
      'GitHub grant failed for customer ctm_1',
      'Adding <octocat> & co failed',
      testServerConfig({ alertEmail: 'ops@example.com' }),
    );

    expect(sent()).toEqual([
      expect.objectContaining({
        from: 'Tenantry <noreply@example.com>',
        to: 'ops@example.com',
        subject: '[Tenantry alert] GitHub grant failed for customer ctm_1',
        html: '<p>Adding &#60;octocat&#62; &#38; co failed</p>',
      }),
    ]);
  });

  it('only logs the alert when ALERT_EMAIL is not set', async () => {
    stubResend();

    await alertOperator('Job evt_1 failed for good', 'detail', testServerConfig({ alertEmail: null }));

    expect(resend).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('ALERT: Job evt_1 failed for good. detail');
  });
});
