import { describe, expect, it, vi } from 'vitest';
import {
  grantAccess,
  hasPendingInvitation,
  membershipOf,
  OrgInvitationApi,
  ProvisioningDeps,
  revokeAccess,
  TeamMembershipApi,
} from './provisioning';

function mockDeps(
  overrides: Partial<TeamMembershipApi> = {},
  invitationOverrides: Partial<OrgInvitationApi> = {},
): { deps: ProvisioningDeps; api: TeamMembershipApi; invitations: OrgInvitationApi } {
  const api: TeamMembershipApi = {
    addOrUpdateMembershipForUserInOrg: vi.fn().mockResolvedValue({ data: { state: 'active' } }),
    removeMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 204 }),
    getMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 200, data: { state: 'active' } }),
    ...overrides,
  };
  const invitations: OrgInvitationApi = {
    listPendingInvitations: vi.fn().mockResolvedValue({ data: [] }),
    cancelInvitation: vi.fn().mockResolvedValue({ status: 204 }),
    ...invitationOverrides,
  };

  return { api, invitations, deps: { api, invitations, org: 'tenantry-org', team: 'pro-customers' } };
}

describe('grantAccess', () => {
  it('adds the user to the configured org team', async () => {
    const { deps, api } = mockDeps();

    await expect(grantAccess('octocat', deps)).resolves.toBe('active');

    expect(api.addOrUpdateMembershipForUserInOrg).toHaveBeenCalledWith({
      org: 'tenantry-org',
      team_slug: 'pro-customers',
      username: 'octocat',
      role: 'member',
    });
  });

  it('reports a pending membership: GitHub sent an org invitation to accept', async () => {
    const { deps } = mockDeps({
      addOrUpdateMembershipForUserInOrg: vi.fn().mockResolvedValue({ data: { state: 'pending' } }),
    });

    await expect(grantAccess('octocat', deps)).resolves.toBe('pending');
  });
});

describe('revokeAccess', () => {
  it('removes the user from the team', async () => {
    const { deps, api, invitations } = mockDeps();

    await revokeAccess('octocat', deps);

    expect(api.removeMembershipForUserInOrg).toHaveBeenCalledWith({
      org: 'tenantry-org',
      team_slug: 'pro-customers',
      username: 'octocat',
    });
    expect(invitations.cancelInvitation).not.toHaveBeenCalled();
  });

  it('cancels a pending org invitation, so it cannot be accepted after access ended', async () => {
    const page = (start: number) =>
      Array.from({ length: 100 }, (_, index) => ({ id: start + index, login: `user${start + index}` }));
    const listPendingInvitations = vi
      .fn()
      .mockResolvedValueOnce({ data: page(1) })
      .mockResolvedValueOnce({
        data: [
          { id: 501, login: null },
          { id: 502, login: 'OctoCat' },
        ],
      });
    const { deps, invitations } = mockDeps({}, { listPendingInvitations });

    await revokeAccess('octocat', deps);

    expect(listPendingInvitations).toHaveBeenLastCalledWith({ org: 'tenantry-org', per_page: 100, page: 2 });
    expect(invitations.cancelInvitation).toHaveBeenCalledExactlyOnceWith({ org: 'tenantry-org', invitation_id: 502 });
  });

  it('ignores a 404 (already removed, or the invitation already gone)', async () => {
    const { deps } = mockDeps(
      { removeMembershipForUserInOrg: vi.fn().mockRejectedValue({ status: 404 }) },
      {
        listPendingInvitations: vi.fn().mockResolvedValue({ data: [{ id: 7, login: 'octocat' }] }),
        cancelInvitation: vi.fn().mockRejectedValue({ status: 404 }),
      },
    );

    await expect(revokeAccess('octocat', deps)).resolves.toBeUndefined();
  });

  it('rethrows non-404 errors', async () => {
    const { deps } = mockDeps({
      removeMembershipForUserInOrg: vi.fn().mockRejectedValue({ status: 500 }),
    });

    await expect(revokeAccess('octocat', deps)).rejects.toMatchObject({ status: 500 });
  });
});

describe('membershipOf', () => {
  it('returns active for a member', async () => {
    const { deps } = mockDeps();

    await expect(membershipOf('octocat', deps)).resolves.toBe('active');
  });

  it('returns pending while the invitation is not accepted', async () => {
    const { deps } = mockDeps({
      getMembershipForUserInOrg: vi.fn().mockResolvedValue({ status: 200, data: { state: 'pending' } }),
    });

    await expect(membershipOf('octocat', deps)).resolves.toBe('pending');
  });

  it('returns null on 404: never invited, the invitation lapsed, or the user was removed', async () => {
    const { deps } = mockDeps({
      getMembershipForUserInOrg: vi.fn().mockRejectedValue({ status: 404 }),
    });

    await expect(membershipOf('octocat', deps)).resolves.toBeNull();
  });
});

describe('hasPendingInvitation', () => {
  it("finds the user's pending org invitation on any page, ignoring the login's case", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index, login: `user${index}` }));
    const { deps } = mockDeps(
      {},
      {
        listPendingInvitations: vi
          .fn()
          .mockResolvedValueOnce({ data: firstPage })
          .mockResolvedValueOnce({ data: [{ id: 502, login: 'OctoCat' }] }),
      },
    );

    await expect(hasPendingInvitation('octocat', deps)).resolves.toBe(true);
  });

  it('returns false when the user has none', async () => {
    const { deps } = mockDeps(
      {},
      { listPendingInvitations: vi.fn().mockResolvedValue({ data: [{ id: 1, login: 'other' }] }) },
    );

    await expect(hasPendingInvitation('octocat', deps)).resolves.toBe(false);
  });
});
