import { beforeEach, describe, expect, it, vi } from 'vitest';
import { switchGithubAccount } from './actions';

const auth = vi.hoisted(() => ({
  getUserIdentities: vi.fn(),
  unlinkIdentity: vi.fn(),
  linkIdentity: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@/utils/supabase/server', () => ({ createClient: async () => ({ auth }) }));
vi.mock('@/utils/github/sync-link', () => ({ isLinkError: () => false, syncGithubLinkForCurrentUser: vi.fn() }));
vi.mock('@/utils/site-origin', () => ({ siteOrigin: async () => 'https://tenantry.dev' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('redirect'), { url });
  },
}));

const github = { provider: 'github', identity_id: 'identity-github' };
const email = { provider: 'email', identity_id: 'identity-email' };

const redirectedTo = () =>
  switchGithubAccount().then(
    () => null,
    (error: { url?: string }) => error.url,
  );

describe('switchGithubAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.unlinkIdentity.mockResolvedValue({ data: {}, error: null });
    auth.linkIdentity.mockResolvedValue({ data: { url: 'https://github.com/login/oauth/authorize?x' }, error: null });
  });

  it('disconnects the GitHub identity and links another, returning through the callback that moves access', async () => {
    auth.getUserIdentities.mockResolvedValue({ data: { identities: [email, github] }, error: null });

    await expect(redirectedTo()).resolves.toBe('https://github.com/login/oauth/authorize?x');

    expect(auth.unlinkIdentity).toHaveBeenCalledWith(github);
    expect(auth.linkIdentity).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://tenantry.dev/auth/callback?next=/dashboard/pro' },
    });
    expect(auth.unlinkIdentity.mock.invocationCallOrder[0]).toBeLessThan(auth.linkIdentity.mock.invocationCallOrder[0]);
  });

  it('asks a login that signs in only with GitHub to set a password first, and changes nothing', async () => {
    auth.getUserIdentities.mockResolvedValue({ data: { identities: [github] }, error: null });

    await expect(redirectedTo()).resolves.toBe('/dashboard/pro?error=github-only-sign-in');
    expect(auth.unlinkIdentity).not.toHaveBeenCalled();
    expect(auth.linkIdentity).not.toHaveBeenCalled();
  });

  it('does not start linking when the identity cannot be disconnected', async () => {
    auth.getUserIdentities.mockResolvedValue({ data: { identities: [email, github] }, error: null });
    auth.unlinkIdentity.mockResolvedValue({ data: null, error: { message: 'failed' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(redirectedTo()).resolves.toBe('/dashboard/pro?error=github-link');
    expect(auth.linkIdentity).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
