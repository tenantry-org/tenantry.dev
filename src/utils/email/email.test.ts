import { afterEach, describe, expect, it } from 'vitest';
import { sendEmail } from './send';
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
});
