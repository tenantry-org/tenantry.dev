import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncGithubLinkForCurrentUser } from './sync-link';

const github = vi.hoisted(() => ({ grantAccess: vi.fn() }));
vi.mock('@/utils/github/provisioning', () => github);

vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            email: 'buyer@example.com',
            identities: [{ provider: 'github', id: '42', identity_data: { user_name: 'octocat', provider_id: '42' } }],
          },
        },
      }),
    },
  }),
}));

vi.mock('@/utils/supabase/server-internal', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return {
    createClient: async () =>
      fakeSupabase({
        customers: { single: { customer_id: 'ctm_1' } },
        entitlements: { single: { id: 'ent_1' } },
      }),
  };
});

describe('syncGithubLinkForCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.PROVISIONING_MODE;
    delete process.env.PROVISION_ALLOWLIST;
  });

  it('links the account but does not grant access when PROVISIONING_MODE is unset', async () => {
    const result = await syncGithubLinkForCurrentUser();

    expect(result).toEqual({ linked: true, granted: false, reason: 'provisioning-disabled' });
    expect(github.grantAccess).not.toHaveBeenCalled();
  });

  it('does not grant access to a customer outside the allowlist', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    process.env.PROVISION_ALLOWLIST = 'someone-else@example.com';

    const result = await syncGithubLinkForCurrentUser();

    expect(result.granted).toBe(false);
    expect(github.grantAccess).not.toHaveBeenCalled();
  });

  it('grants access in automated mode', async () => {
    process.env.PROVISIONING_MODE = 'auto';

    const result = await syncGithubLinkForCurrentUser();

    expect(result).toEqual({ linked: true, granted: true });
    expect(github.grantAccess).toHaveBeenCalledWith('octocat');
  });
});
