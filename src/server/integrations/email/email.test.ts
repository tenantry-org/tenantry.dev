import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertOperator } from './alerts';
import { resendRequest, sendEmail } from './send';
import { accessRevokedEmail, welcomeProEmail } from './templates';

describe('sendEmail', () => {
  const previous = process.env.RESEND_API_KEY;
  afterEach(() => {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  });

  it('skips (returns false) without throwing when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' })).resolves.toBe(false);
  });

  it('sends replies to EMAIL_REPLY_TO, from the configured no-reply sender', () => {
    const message = { to: 'cust@example.com', subject: 's', html: '<p>x</p>' };

    expect(
      resendRequest(message, {
        EMAIL_FROM: 'Tenantry <noreply@tenantry.dev>',
        EMAIL_REPLY_TO: ' support@tenantry.dev ',
      }),
    ).toEqual({ from: 'Tenantry <noreply@tenantry.dev>', reply_to: 'support@tenantry.dev', ...message });
    expect(resendRequest(message, {})).not.toHaveProperty('reply_to');
  });
});

describe('email templates', () => {
  it('welcomeProEmail targets the customer and links the Pro dashboard', () => {
    const msg = welcomeProEmail('cust@example.com');

    expect(msg.to).toBe('cust@example.com');
    expect(msg.subject).toMatch(/Tenantry Pro/);
    expect(msg.html).toContain('/dashboard/pro');
  });

  it('accessRevokedEmail targets the customer and mentions ending', () => {
    const msg = accessRevokedEmail('cust@example.com');

    expect(msg.to).toBe('cust@example.com');
    expect(msg.html).toMatch(/ended|removed/i);
  });

  it('promises only the package feed, not repository access', () => {
    // A subscription gives access to the private package feed only (D10); neither email may claim more.
    for (const msg of [welcomeProEmail('cust@example.com'), accessRevokedEmail('cust@example.com')]) {
      expect(msg.html).toContain('package feed');
      expect(msg.html).not.toMatch(/repositor|source code/i);
    }
  });
});

describe('alertOperator', () => {
  const resend = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  const sent = () => resend.mock.calls.map(([, init]) => JSON.parse(init?.body as string));

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks(); // the console spy
    resend.mockClear();
  });

  function stubResend() {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubGlobal('fetch', resend);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  }

  it('emails the operator at ALERT_EMAIL, with the detail escaped', async () => {
    stubResend();
    vi.stubEnv('ALERT_EMAIL', ' ops@example.com ');

    await alertOperator('GitHub grant failed for customer ctm_1', 'Adding <octocat> & co failed');

    expect(sent()).toEqual([
      expect.objectContaining({
        to: 'ops@example.com',
        subject: '[Tenantry alert] GitHub grant failed for customer ctm_1',
        html: '<p>Adding &#60;octocat&#62; &#38; co failed</p>',
      }),
    ]);
  });

  it('only logs the alert when ALERT_EMAIL is not set', async () => {
    stubResend();
    vi.stubEnv('ALERT_EMAIL', '');

    await alertOperator('Inbox event evt_1 failed for good', 'detail');

    expect(resend).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('ALERT: Inbox event evt_1 failed for good. detail');
  });
});
