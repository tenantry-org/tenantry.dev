import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall } from '@/utils/testing/fake-supabase';
import { syncGithubLinkForCurrentUser } from './sync-link';

const github = vi.hoisted(() => ({ grantAccess: vi.fn(), revokeAccess: vi.fn(), currentLogin: vi.fn() }));
vi.mock('@/utils/github/provisioning', () => github);

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  accessStatus: 'active',
  calls: [] as FakeCall[],
  /** The customer's current link, and the customer (if any) already holding the signing-in GitHub id. */
  previousLink: null as { github_login: string; github_id: number } | null,
  holder: null as { customer_id: string } | null,
  linkWriteError: undefined as { code: string; message: string } | undefined,
  failLookup: false,
  /** Whether one of the customer's inbox events is in progress, so no lease is granted. */
  customerBusy: false,
}));

function signedInUser(overrides: Record<string, unknown> = {}) {
  return {
    email: 'buyer@example.com',
    email_confirmed_at: '2026-09-01T00:00:00Z',
    identities: [{ provider: 'github', id: '42', identity_data: { user_name: 'octocat', provider_id: '42' } }],
    ...overrides,
  };
}

vi.mock('@/utils/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock('@/utils/supabase/server-internal', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return {
    createClient: () =>
      fakeSupabase(
        {
          customers: { single: { customer_id: 'ctm_1' } },
          customer_access: { single: { status: state.accessStatus } },
          github_links: {
            single: (filters: Record<string, unknown>) => {
              if (state.failLookup) throw new Error('database unavailable');
              return 'github_id' in filters ? state.holder : state.previousLink;
            },
            writeError: state.linkWriteError,
          },
        },
        state.calls,
        {
          acquire_customer_lease: () => (state.customerBusy ? null : 'lease_1'),
          release_customer_lease: () => null,
        },
      ),
  };
});

describe('syncGithubLinkForCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = signedInUser();
    state.accessStatus = 'active';
    state.calls.length = 0;
    state.previousLink = null;
    state.holder = null;
    state.linkWriteError = undefined;
    state.failLookup = false;
    state.customerBusy = false;
    // GitHub's current logins, by account id.
    github.currentLogin.mockImplementation(async (id: number) => ({ 42: 'octocat', 7: 'old-account' })[id] ?? null);
  });

  afterEach(() => {
    delete process.env.PROVISIONING_MODE;
  });

  it('links the account but does not grant access when PROVISIONING_MODE is unset', async () => {
    const result = await syncGithubLinkForCurrentUser();

    expect(result).toEqual({ linked: true, granted: false, reason: 'provisioning-disabled' });
    expect(github.grantAccess).not.toHaveBeenCalled();
  });

  it('grants access in automated mode, and records an org invitation to accept as invited', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    github.grantAccess.mockResolvedValueOnce('pending');

    const result = await syncGithubLinkForCurrentUser();

    expect(result).toEqual({ linked: true, granted: true, invited: true });
    expect(github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        table: 'customer_access',
        method: 'update',
        args: [expect.objectContaining({ github_state: 'invited' })],
      }),
    );
  });

  it('records an existing org member as active', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    github.grantAccess.mockResolvedValueOnce('active');

    await expect(syncGithubLinkForCurrentUser()).resolves.toEqual({ linked: true, granted: true, invited: false });
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        table: 'customer_access',
        method: 'update',
        args: [expect.objectContaining({ github_state: 'active', github_invited_at: null })],
      }),
    );
  });

  it("links but does not grant access when none of the customer's subscriptions entitles them", async () => {
    process.env.PROVISIONING_MODE = 'auto';
    state.accessStatus = 'revoked';

    const result = await syncGithubLinkForCurrentUser();

    expect(result).toEqual({ linked: true, granted: false, reason: 'no-active-entitlement' });
    expect(github.grantAccess).not.toHaveBeenCalled();
  });

  it('does not link an account whose email is not confirmed, and looks nothing up', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    state.user = signedInUser({ email_confirmed_at: null });

    const result = await syncGithubLinkForCurrentUser();

    expect(result).toEqual({ linked: false, granted: false, reason: 'email-not-confirmed' });
    expect(state.calls).toEqual([]);
    expect(github.grantAccess).not.toHaveBeenCalled();
  });

  it('matches the customer by the confirmed email, lowercased and trimmed, and writes the link', async () => {
    state.user = signedInUser({ email: ' Buyer@Example.COM ' });

    const result = await syncGithubLinkForCurrentUser();

    expect(result.linked).toBe(true);
    expect(state.calls).toContainEqual({ table: 'customers', method: 'eq', args: ['email', 'buyer@example.com'] });
    expect(state.calls).toContainEqual({
      table: 'github_links',
      method: 'upsert',
      args: [{ customer_id: 'ctm_1', github_login: 'octocat', github_id: 42 }, { onConflict: 'customer_id' }],
    });
  });

  it('grants the account under its current login when it was renamed since the user last signed in', async () => {
    process.env.PROVISIONING_MODE = 'auto';
    github.grantAccess.mockResolvedValueOnce('active');
    github.currentLogin.mockImplementation(async () => 'octocat-renamed');

    await syncGithubLinkForCurrentUser();

    expect(github.grantAccess).toHaveBeenCalledWith('octocat-renamed');
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        table: 'github_links',
        method: 'upsert',
        args: [expect.objectContaining({ github_login: 'octocat-renamed', github_id: 42 }), expect.anything()],
      }),
    );
  });

  describe('account linking', () => {
    beforeEach(() => {
      process.env.PROVISIONING_MODE = 'auto';
      github.grantAccess.mockResolvedValue('active');
    });

    const linkWrites = () => state.calls.filter((call) => call.table === 'github_links' && call.method === 'upsert');
    const leaseCalls = () => state.calls.filter((call) => call.table.startsWith('rpc:')).map((call) => call.table);

    it("changes the link holding the customer's lease, so no reconcile can re-add the previous account", async () => {
      state.previousLink = { github_login: 'old-account', github_id: 7 };
      github.revokeAccess.mockImplementation(async () => {
        state.calls.push({ table: 'github:revoke', method: 'revoke', args: [] });
      });
      github.grantAccess.mockImplementation(async () => {
        state.calls.push({ table: 'github:grant', method: 'grant', args: [] });
        return 'active';
      });

      await syncGithubLinkForCurrentUser();

      const order = state.calls
        .map((call) => call.table)
        .filter((table) => table.startsWith('rpc:') || table.startsWith('github:') || table === 'github_links');
      expect(order.indexOf('rpc:acquire_customer_lease')).toBeLessThan(order.indexOf('github:revoke'));
      expect(order.lastIndexOf('rpc:release_customer_lease')).toBeGreaterThan(order.indexOf('github:grant'));
      expect(order.indexOf('rpc:acquire_customer_lease')).toBeLessThan(order.indexOf('github_links'));
    });

    it("changes nothing while one of the customer's events is in progress, and says so", async () => {
      vi.useFakeTimers();
      try {
        state.previousLink = { github_login: 'old-account', github_id: 7 };
        state.customerBusy = true;

        const result = syncGithubLinkForCurrentUser();
        await vi.advanceTimersByTimeAsync(11_000);

        await expect(result).resolves.toEqual({ linked: false, granted: false, reason: 'link-busy' });
        expect(github.revokeAccess).not.toHaveBeenCalled();
        expect(github.grantAccess).not.toHaveBeenCalled();
        expect(linkWrites()).toEqual([]);
        expect(leaseCalls()).not.toContain('rpc:release_customer_lease');
      } finally {
        vi.useRealTimers();
      }
    });

    it('releases the lease when linking fails', async () => {
      state.linkWriteError = { code: '08006', message: 'connection failure' };

      await expect(syncGithubLinkForCurrentUser()).resolves.toMatchObject({ reason: 'sync-failed' });
      expect(leaseCalls()).toEqual(['rpc:acquire_customer_lease', 'rpc:release_customer_lease']);
    });

    it('removes the previous GitHub account from the team before linking a different one', async () => {
      state.previousLink = { github_login: 'old-account', github_id: 7 };

      await expect(syncGithubLinkForCurrentUser()).resolves.toMatchObject({ linked: true, granted: true });

      expect(github.revokeAccess).toHaveBeenCalledExactlyOnceWith('old-account');
      expect(github.revokeAccess.mock.invocationCallOrder[0]).toBeLessThan(
        github.grantAccess.mock.invocationCallOrder[0],
      );
      expect(state.calls).toContainEqual(
        expect.objectContaining({
          table: 'customer_access',
          method: 'update',
          args: [expect.objectContaining({ github_state: 'none', github_invited_at: null })],
        }),
      );
      expect(linkWrites()).toHaveLength(1);
    });

    it('removes the previous account under its current login when it was renamed since it was linked', async () => {
      state.previousLink = { github_login: 'old-account', github_id: 7 };
      github.currentLogin.mockImplementation(async (id: number) => (id === 7 ? 'old-account-renamed' : 'octocat'));

      await syncGithubLinkForCurrentUser();

      expect(github.revokeAccess).toHaveBeenCalledExactlyOnceWith('old-account-renamed');
    });

    it('links the new account when the previous one has been deleted, which took its access with it', async () => {
      state.previousLink = { github_login: 'old-account', github_id: 7 };
      github.currentLogin.mockImplementation(async (id: number) => (id === 7 ? null : 'octocat'));

      await expect(syncGithubLinkForCurrentUser()).resolves.toMatchObject({ linked: true, granted: true });
      expect(github.revokeAccess).not.toHaveBeenCalled();
    });

    it('keeps access for a renamed account: same GitHub id, new login', async () => {
      state.previousLink = { github_login: 'octocat-old-name', github_id: 42 };

      await expect(syncGithubLinkForCurrentUser()).resolves.toMatchObject({ linked: true, granted: true });
      expect(github.revokeAccess).not.toHaveBeenCalled();
      expect(linkWrites()[0].args[0]).toMatchObject({ github_login: 'octocat', github_id: 42 });
    });

    it('keeps the old link when the previous account cannot be removed, so the user can retry', async () => {
      state.previousLink = { github_login: 'old-account', github_id: 7 };
      github.revokeAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));

      await expect(syncGithubLinkForCurrentUser()).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'relink-failed',
      });
      expect(linkWrites()).toEqual([]);
      expect(github.grantAccess).not.toHaveBeenCalled();
    });

    it('refuses a GitHub account that is linked to another customer, and grants nothing', async () => {
      state.holder = { customer_id: 'ctm_other' };

      await expect(syncGithubLinkForCurrentUser()).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'github-account-linked-elsewhere',
      });
      expect(linkWrites()).toEqual([]);
      expect(github.revokeAccess).not.toHaveBeenCalled();
      expect(github.grantAccess).not.toHaveBeenCalled();
    });

    it('refuses the account when another customer links it at the same moment (unique github_id)', async () => {
      state.linkWriteError = { code: '23505', message: 'duplicate key value violates unique constraint' };

      await expect(syncGithubLinkForCurrentUser()).resolves.toMatchObject({
        linked: false,
        reason: 'github-account-linked-elsewhere',
      });
      expect(github.grantAccess).not.toHaveBeenCalled();
    });

    it('returns a failure instead of throwing when something unexpected fails', async () => {
      state.failLookup = true;
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(syncGithubLinkForCurrentUser()).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'sync-failed',
      });
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });
  });
});
