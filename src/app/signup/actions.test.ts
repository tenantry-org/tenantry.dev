import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signup } from './actions';

const auth = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('@/server/db/user-client', () => ({ createUserClient: async () => ({ auth }) }));
// This environment's site URL is https://sandbox.example.com.
vi.mock('@/server/config/server-config', async () => ({
  serverConfig: (await import('@/test/server-config')).testServerConfig,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  auth.signUp.mockResolvedValue({ data: {}, error: null });
});

describe('signup', () => {
  it('sends a confirmation link that continues to the page asked for, with the Turnstile token', async () => {
    expect(
      await signup({ email: 'me@example.com', password: 'secret-pw', captchaToken: 'turnstile' }, '/checkout/pri_1'),
    ).toEqual({ sent: true });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'secret-pw',
      options: {
        emailRedirectTo: 'https://sandbox.example.com/auth/callback?next=%2Fcheckout%2Fpri_1',
        captchaToken: 'turnstile',
      },
    });
  });

  it('sends no token when the site has no Turnstile site key', async () => {
    await signup({ email: 'me@example.com', password: 'secret-pw' });
    expect(auth.signUp.mock.calls[0][0].options).toEqual({
      emailRedirectTo: 'https://sandbox.example.com/auth/callback?next=%2Fdashboard%2Fpro',
      captchaToken: undefined,
    });
  });

  it.each([
    ['email_address_not_authorized', 'could not send a confirmation email to this address'],
    ['captcha_failed', 'did not pass'],
    ['over_email_send_rate_limit', 'Too many sign-up emails'],
  ])('explains %s', async (code, message) => {
    auth.signUp.mockResolvedValue({ data: null, error: { code, message: 'x' } });
    expect(await signup({ email: 'me@example.com', password: 'secret-pw' })).toEqual({
      error: expect.stringContaining(message),
    });
  });

  it('answers anything else with the generic message', async () => {
    auth.signUp.mockResolvedValue({ data: null, error: { code: 'unexpected_failure', message: 'x' } });
    expect(await signup({ email: 'me@example.com', password: 'secret-pw' })).toEqual({
      error: 'Something went wrong. Please try again.',
    });
  });
});
