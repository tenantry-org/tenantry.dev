import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { login } from './actions';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock('@/server/db/user-client', () => ({ createUserClient: async () => ({ auth }) }));
vi.mock('@/server/config/server-config', async () => ({
  serverConfig: (await import('@/test/server-config')).testServerConfig,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const credentials = { email: 'me@example.com', password: 'a-password' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
});

describe('login', () => {
  it('signs in, with the Turnstile token when there is one, and continues to the page it was given', async () => {
    await expect(login({ ...credentials, captchaToken: 'turnstile' }, '/checkout/pri_1')).rejects.toThrow(
      'redirect:/checkout/pri_1',
    );
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ ...credentials, options: { captchaToken: 'turnstile' } });
  });

  it('says when the check for scripts did not pass, rather than blame the password', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'captcha_failed', message: 'x' } });
    expect(await login(credentials)).toEqual({ error: expect.stringContaining('did not pass') });
  });

  it('reports a wrong password as one', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', message: 'x' } });
    expect(await login(credentials)).toEqual({ error: 'Invalid email or password.' });
  });

  it('tells a customer who has not confirmed their address to confirm it, not that the password is wrong', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'email_not_confirmed', message: 'x' } });
    expect(await login(credentials)).toEqual({ error: expect.stringContaining('Confirm your email address') });
  });

  it('explains a rate limit', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'over_request_rate_limit', message: 'x' } });
    expect(await login(credentials)).toEqual({ error: expect.stringContaining('wait a minute') });
  });

  it('reports Auth out of reach as a failure to retry and logs it', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: new AuthRetryableFetchError('fetch failed', 0) });
    expect(await login(credentials)).toEqual({ error: 'Something went wrong. Please try again.' });
    expect(console.error).toHaveBeenCalledWith('Sign-in failed:', undefined, 'fetch failed');
  });
});
