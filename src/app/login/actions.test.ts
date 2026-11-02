import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login } from './actions';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock('@/server/db/user-client', () => ({ createUserClient: async () => ({ auth }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/server/config/server-config', async () => ({
  serverConfig: (await import('@/test/server-config')).testServerConfig,
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
});

describe('login', () => {
  it('signs in with the Turnstile token and continues to the page asked for', async () => {
    await login({ email: 'me@example.com', password: 'secret-pw', captchaToken: 'turnstile' }, '/checkout/pri_1');

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'secret-pw',
      options: { captchaToken: 'turnstile' },
    });
    expect(redirect).toHaveBeenCalledWith('/checkout/pri_1');
  });

  it('says the same for a wrong password and an unknown address', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: null, error: { code: 'invalid_credentials', message: 'x' } });

    expect(await login({ email: 'me@example.com', password: 'wrong-pw' })).toEqual({
      error: 'Invalid email or password',
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('says when the check for scripts did not pass, rather than blame the password', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: null, error: { code: 'captcha_failed', message: 'x' } });

    expect(await login({ email: 'me@example.com', password: 'secret-pw' })).toEqual({
      error: expect.stringContaining('did not pass'),
    });
  });
});
