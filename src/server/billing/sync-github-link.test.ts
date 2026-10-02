import type { User } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_BUSY } from '@/server/jobs/customer-lease';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';
import { syncGithubLinkForCurrentUser } from './sync-github-link';

let deps: FakeBillingDeps;

function signedInUser(overrides: Record<string, unknown> = {}): User {
  return {
    email: 'buyer@example.com',
    email_confirmed_at: '2026-09-01T00:00:00Z',
    identities: [{ provider: 'github', id: '42', identity_data: { user_name: 'octocat', provider_id: '42' } }],
    ...overrides,
  } as unknown as User;
}

/** Links the customer's previous GitHub account, as an earlier sync did. */
function linkPrevious(id: number, login: string) {
  memory.state.githubAccounts.set('ctm_1', { id, login });
}

const link = () => memory.state.githubAccounts.get('ctm_1');
const access = () => memory.state.access.get('ctm_1');

describe('syncGithubLinkForCurrentUser', () => {
  beforeEach(() => {
    deps = fakeBillingDeps();
    deps.currentUser.mockResolvedValue(signedInUser());
    // GitHub's current logins, by account id.
    deps.github.currentLogin.mockImplementation(async (id) => ({ 42: 'octocat', 7: 'old-account' })[id] ?? null);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.state.access.set('ctm_1', { status: 'active', githubState: 'none', githubInvitedAt: null });
  });

  afterEach(() => {
    vi.restoreAllMocks(); // the console spies
  });

  it('links the account but does not grant access while provisioning is manual', async () => {
    deps.config = testServerConfig({ provisioning: 'manual' });

    const result = await syncGithubLinkForCurrentUser(deps);

    expect(result).toEqual({ linked: true, granted: false, reason: 'provisioning-disabled' });
    expect(link()).toEqual({ id: 42, login: 'octocat' });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
  });

  it('grants access in automated mode, and records an org invitation to accept as invited', async () => {
    deps.github.grantAccess.mockResolvedValueOnce('pending');

    const result = await syncGithubLinkForCurrentUser(deps);

    expect(result).toEqual({ linked: true, granted: true, invited: true });
    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(access()).toMatchObject({ githubState: 'invited', githubInvitedAt: expect.any(Date) });
  });

  it('records an existing org member as active', async () => {
    await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({ linked: true, granted: true, invited: false });
    expect(access()).toMatchObject({ githubState: 'active', githubInvitedAt: null });
  });

  it("links but does not grant access when none of the customer's subscriptions entitles them", async () => {
    memory.state.access.set('ctm_1', { status: 'revoked', githubState: 'none', githubInvitedAt: null });

    const result = await syncGithubLinkForCurrentUser(deps);

    expect(result).toEqual({ linked: true, granted: false, reason: 'no-active-entitlement' });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
  });

  it('does not link an account whose email is not confirmed, and looks nothing up', async () => {
    deps.currentUser.mockResolvedValue(signedInUser({ email_confirmed_at: null }));
    const findCustomer = vi.spyOn(deps.store, 'findCustomerIdByEmail');

    const result = await syncGithubLinkForCurrentUser(deps);

    expect(result).toEqual({ linked: false, granted: false, reason: 'email-not-confirmed' });
    expect(findCustomer).not.toHaveBeenCalled();
    expect(link()).toBeUndefined();
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
  });

  it('matches the customer by the confirmed email, lowercased and trimmed, and writes the link', async () => {
    deps.currentUser.mockResolvedValue(signedInUser({ email: ' Buyer@Example.COM ' }));
    const findCustomer = vi.spyOn(deps.store, 'findCustomerIdByEmail');

    const result = await syncGithubLinkForCurrentUser(deps);

    expect(result.linked).toBe(true);
    expect(findCustomer).toHaveBeenCalledWith('buyer@example.com');
    expect(link()).toEqual({ id: 42, login: 'octocat' });
  });

  it('does not link a signed-in user who has not bought Pro', async () => {
    memory.state.emails.clear();

    await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({
      linked: false,
      granted: false,
      reason: 'no-customer',
    });
  });

  it('grants the account under its current login when it was renamed since the user last signed in', async () => {
    deps.github.currentLogin.mockImplementation(async () => 'octocat-renamed');

    await syncGithubLinkForCurrentUser(deps);

    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat-renamed');
    expect(link()).toEqual({ id: 42, login: 'octocat-renamed' });
  });

  it('neither links nor grants a deleted account, whose login someone else may have taken', async () => {
    deps.github.currentLogin.mockImplementation(async () => null);

    await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({
      linked: false,
      granted: false,
      reason: 'github-account-deleted',
    });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(link()).toBeUndefined();
  });

  describe('account linking', () => {
    it("changes the link holding the customer's lease, so no reconcile can re-add the previous account", async () => {
      linkPrevious(7, 'old-account');
      const steps: string[] = [];
      vi.spyOn(deps, 'withCustomerLease').mockImplementation(async (_customerId, work) => {
        steps.push('acquire');
        try {
          return await work();
        } finally {
          steps.push('release');
        }
      });
      deps.github.revokeAccess.mockImplementation(async () => {
        steps.push('revoke');
      });
      deps.github.grantAccess.mockImplementation(async () => {
        steps.push('grant');
        return 'active';
      });
      const linkAccount = deps.store.linkGithubAccount;
      vi.spyOn(deps.store, 'linkGithubAccount').mockImplementation(async (customerId, account) => {
        steps.push('link');
        return linkAccount(customerId, account);
      });

      await syncGithubLinkForCurrentUser(deps);

      expect(steps).toEqual(['acquire', 'revoke', 'link', 'grant', 'release']);
    });

    it("changes nothing while one of the customer's jobs is in progress, and says so", async () => {
      linkPrevious(7, 'old-account');
      vi.spyOn(deps, 'withCustomerLease').mockResolvedValue(CUSTOMER_BUSY);

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'link-busy',
      });
      expect(deps.github.revokeAccess).not.toHaveBeenCalled();
      expect(deps.github.grantAccess).not.toHaveBeenCalled();
      expect(link()).toEqual({ id: 7, login: 'old-account' });
    });

    it('returns a failure when the link cannot be written', async () => {
      vi.spyOn(deps.store, 'linkGithubAccount').mockRejectedValue({ code: '08006', message: 'connection failure' });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toMatchObject({ reason: 'sync-failed' });
      expect(deps.github.grantAccess).not.toHaveBeenCalled();
    });

    it('removes the previous GitHub account from the team before linking a different one', async () => {
      linkPrevious(7, 'old-account');
      const resetState = vi.spyOn(deps.store, 'resetGithubState');

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toMatchObject({ linked: true, granted: true });

      expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('old-account');
      expect(deps.github.revokeAccess.mock.invocationCallOrder[0]).toBeLessThan(
        deps.github.grantAccess.mock.invocationCallOrder[0],
      );
      expect(resetState).toHaveBeenCalledWith('ctm_1');
      expect(link()).toEqual({ id: 42, login: 'octocat' });
    });

    it('removes the previous account under its current login when it was renamed since it was linked', async () => {
      linkPrevious(7, 'old-account');
      deps.github.currentLogin.mockImplementation(async (id) => (id === 7 ? 'old-account-renamed' : 'octocat'));

      await syncGithubLinkForCurrentUser(deps);

      expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('old-account-renamed');
    });

    it('links the new account when the previous one has been deleted, which took its access with it', async () => {
      linkPrevious(7, 'old-account');
      deps.github.currentLogin.mockImplementation(async (id) => (id === 7 ? null : 'octocat'));

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toMatchObject({ linked: true, granted: true });
      expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    });

    it('keeps access for a renamed account: same GitHub id, new login', async () => {
      linkPrevious(42, 'octocat-old-name');

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toMatchObject({ linked: true, granted: true });
      expect(deps.github.revokeAccess).not.toHaveBeenCalled();
      expect(link()).toEqual({ id: 42, login: 'octocat' });
    });

    it('keeps the old link when the previous account cannot be removed, so the user can retry', async () => {
      linkPrevious(7, 'old-account');
      deps.github.revokeAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'relink-failed',
      });
      expect(link()).toEqual({ id: 7, login: 'old-account' });
      expect(deps.github.grantAccess).not.toHaveBeenCalled();
    });

    it('refuses a GitHub account that is linked to another customer, and grants nothing', async () => {
      memory.state.githubAccounts.set('ctm_other', { id: 42, login: 'octocat' });

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'github-account-linked-elsewhere',
      });
      expect(link()).toBeUndefined();
      expect(deps.github.revokeAccess).not.toHaveBeenCalled();
      expect(deps.github.grantAccess).not.toHaveBeenCalled();
    });

    it('refuses the account when another customer links it at the same moment (unique github_id)', async () => {
      vi.spyOn(deps.store, 'linkGithubAccount').mockResolvedValueOnce(false);

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toMatchObject({
        linked: false,
        reason: 'github-account-linked-elsewhere',
      });
      expect(deps.github.grantAccess).not.toHaveBeenCalled();
    });

    it('returns a failure instead of throwing when something unexpected fails', async () => {
      vi.spyOn(deps.store, 'getGithubAccount').mockRejectedValue(new Error('database unavailable'));
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(syncGithubLinkForCurrentUser(deps)).resolves.toEqual({
        linked: false,
        granted: false,
        reason: 'sync-failed',
      });
      expect(log).toHaveBeenCalled();
    });
  });
});
