import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPasswordReset } from './actions';

const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn() }));
vi.mock('@/server/db/user-client', () => ({ createUserClient: async () => ({ auth }) }));
// This environment's site URL is https://sandbox.example.com.
vi.mock('@/server/config/server-config', async () => ({
  serverConfig: (await import('@/test/server-config')).testServerConfig,
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

describe('requestPasswordReset', () => {
  it('sends a link that signs in through the callback and opens the new-password page', async () => {
    expect(await requestPasswordReset('me@example.com')).toEqual({ sent: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('me@example.com', {
      redirectTo: 'https://sandbox.example.com/auth/callback?next=/reset-password',
    });
  });

  it('answers as sent when Supabase fails for a reason the customer cannot act on, revealing no account', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'user_not_found', message: 'x' } });
    expect(await requestPasswordReset('nobody@example.com')).toEqual({ sent: true });
  });

  it('explains a rate limit', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { code: 'over_email_send_rate_limit', message: 'x' },
    });
    expect(await requestPasswordReset('me@example.com')).toEqual({ error: expect.stringContaining('wait a minute') });
  });
});
