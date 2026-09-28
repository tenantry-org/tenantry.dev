import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall } from '@/utils/testing/fake-supabase';
import { syncGithubLinkForCurrentUser } from './sync-link';

const github = vi.hoisted(() => ({ grantAccess: vi.fn() }));
vi.mock('@/utils/github/provisioning', () => github);

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  accessStatus: 'active',
  calls: [] as FakeCall[],
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
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock('@/utils/supabase/server-internal', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return {
    createClient: async () =>
      fakeSupabase(
        {
          customers: { single: { customer_id: 'ctm_1' } },
          customer_access: { single: { status: state.accessStatus } },
        },
        state.calls,
      ),
  };
});

describe('syncGithubLinkForCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = signedInUser();
    state.accessStatus = 'active';
    state.calls.length = 0;
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
});
