import { describe, expect, it, vi } from 'vitest';
import { grantAccess, hasAccess, ProvisioningDeps, revokeAccess, TeamMembershipApi } from './provisioning';

function mockDeps(overrides: Partial<TeamMembershipApi> = {}): { deps: ProvisioningDeps; api: TeamMembershipApi } {
  const api: TeamMembershipApi = {
    addOrUpdateMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 200 }),
    removeMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 204 }),
    getMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 200, data: { state: 'active' } }),
    ...overrides,
  };

  return { api, deps: { api, org: 'tenantry-org', team: 'pro-customers' } };
}

describe('grantAccess', () => {
  it('adds the user to the configured org team', async () => {
    const { deps, api } = mockDeps();

    await grantAccess('octocat', deps);

    expect(api.addOrUpdateMembershipForUserInOrg).toHaveBeenCalledWith({
      org: 'tenantry-org',
      team_slug: 'pro-customers',
      username: 'octocat',
      role: 'member',
    });
  });
});

describe('revokeAccess', () => {
  it('removes the user from the team', async () => {
    const { deps, api } = mockDeps();

    await revokeAccess('octocat', deps);

    expect(api.removeMembershipForUserInOrg).toHaveBeenCalledWith({
      org: 'tenantry-org',
      team_slug: 'pro-customers',
      username: 'octocat',
    });
  });

  it('ignores a 404 (already removed)', async () => {
    const { deps } = mockDeps({
      removeMembershipForUserInOrg: vi.fn().mockRejectedValue({ status: 404 }),
    });

    await expect(revokeAccess('octocat', deps)).resolves.toBeUndefined();
  });

  it('rethrows non-404 errors', async () => {
    const { deps } = mockDeps({
      removeMembershipForUserInOrg: vi.fn().mockRejectedValue({ status: 500 }),
    });

    await expect(revokeAccess('octocat', deps)).rejects.toMatchObject({ status: 500 });
  });
});

describe('hasAccess', () => {
  it('returns true for an active member', async () => {
    const { deps } = mockDeps();

    await expect(hasAccess('octocat', deps)).resolves.toBe(true);
  });

  it('returns false when membership is pending', async () => {
    const { deps } = mockDeps({
      getMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 200, data: { state: 'pending' } }),
    });

    await expect(hasAccess('octocat', deps)).resolves.toBe(false);
  });

  it('returns false on 404', async () => {
    const { deps } = mockDeps({
      getMembershipForUserInOrg: vi.fn().mockRejectedValue({ status: 404 }),
    });

    await expect(hasAccess('octocat', deps)).resolves.toBe(false);
  });
});
