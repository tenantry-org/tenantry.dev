import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileEntitlements } from './reconcile';

const github = vi.hoisted(() => ({ grantAccess: vi.fn(), hasAccess: vi.fn(), revokeAccess: vi.fn() }));
vi.mock('@/utils/github/provisioning', () => github);

vi.mock('@/utils/supabase/server-internal', async () => {
  const { fakeSupabase } = await import('@/utils/testing/fake-supabase');
  return {
    createClient: async () =>
      fakeSupabase({
        // An entitled customer with a linked GitHub account whose grant is still pending.
        entitlements: { list: [{ customer_id: 'ctm_1' }] },
        github_links: { single: { github_login: 'octocat' }, list: [] },
        customers: { single: { email: 'buyer@example.com' } },
      }),
  };
});

describe('reconcileEntitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.PROVISIONING_MODE;
  });

  it('does not grant pending access when PROVISIONING_MODE is unset', async () => {
    const result = await reconcileEntitlements();

    expect(github.grantAccess).not.toHaveBeenCalled();
    expect(result.granted).toEqual([]);
  });

  it('grants pending access in automated mode', async () => {
    process.env.PROVISIONING_MODE = 'auto';

    const result = await reconcileEntitlements();

    expect(github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(result.granted).toEqual(['ctm_1']);
  });
});
