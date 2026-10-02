import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionEntitlement } from '@/utils/entitlements/entitlements-store';
import { memory } from '@/utils/testing/memory-entitlements';
import { syncCustomerAccess } from './customer-access';
import { reconcileCustomer } from './reconcile-customer';

const effects = vi.hoisted(() => ({
  grantAccess: vi.fn(),
  revokeAccess: vi.fn(),
  membershipOf: vi.fn(),
  hasPendingInvitation: vi.fn(),
  sendEmail: vi.fn(),
  automatedProvisioningEnabled: vi.fn(),
}));
vi.mock('@/utils/github/provisioning', async () => {
  const { memory } = await import('@/utils/testing/memory-entitlements');
  return {
    grantAccess: effects.grantAccess,
    revokeAccess: effects.revokeAccess,
    membershipOf: effects.membershipOf,
    hasPendingInvitation: effects.hasPendingInvitation,
    currentLogin: memory.currentLogin,
  };
});
vi.mock('@/utils/entitlements/entitlements-store', async () => {
  const { memory } = await import('@/utils/testing/memory-entitlements');
  return memory.store;
});
vi.mock('@/utils/email/send', () => ({ sendEmail: effects.sendEmail }));
vi.mock('@/utils/licensing/licence-issuer', () => ({
  issueLicence: ({ customerId }: { customerId: string }) => `licence:${customerId}`,
}));
vi.mock('@/utils/provisioning-guard', () => ({ automatedProvisioningEnabled: effects.automatedProvisioningEnabled }));

const OCTOBER = new Date('2026-10-01T00:00:00Z');
const NOVEMBER = new Date('2026-11-01T00:00:00Z');

async function record(overrides: Partial<SubscriptionEntitlement> = {}) {
  await memory.store.upsertEntitlement({
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
    status: 'active',
    currentPeriodEndsAt: NOVEMBER,
    graceStartedAt: null,
    ...overrides,
  });
}

/** Starts the customer's access as the webhook does; GitHub answers the grant with `membership`. */
async function startAccess(membership: 'active' | 'pending' = 'active') {
  effects.grantAccess.mockResolvedValueOnce(membership);
  await record();
  await syncCustomerAccess('ctm_1');
  vi.clearAllMocks();
}

const githubState = () => memory.state.access.get('ctm_1')?.githubState;

describe('reconcileCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:10:00Z'));
    effects.automatedProvisioningEnabled.mockReturnValue(true);
    effects.grantAccess.mockResolvedValue('active');
    effects.membershipOf.mockResolvedValue(null);
    effects.hasPendingInvitation.mockResolvedValue(false);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.linkGithub('ctm_1', 'octocat');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends access once the grace period is over, with no event from Paddle', async () => {
    await startAccess();
    await record({ status: 'grace', graceStartedAt: OCTOBER });
    await syncCustomerAccess('ctm_1');
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ access: 'ended' });

    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'revoked', githubState: 'none' });
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(effects.sendEmail).toHaveBeenCalledOnce();
  });

  it('changes nothing for an entitled member whose licence is in place', async () => {
    await startAccess('active');
    effects.membershipOf.mockResolvedValue('active');

    await expect(reconcileCustomer('ctm_1')).resolves.toEqual({
      access: 'unchanged',
      licence: 'current',
      github: 'unchanged',
      licencesRevoked: false,
    });
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  describe('org invitations', () => {
    it('records an invitation GitHub sent when access started, and leaves it pending until accepted', async () => {
      await startAccess('pending');
      expect(memory.state.access.get('ctm_1')).toMatchObject({
        githubState: 'invited',
        githubInvitedAt: new Date('2026-10-01T00:10:00Z'),
      });

      effects.membershipOf.mockResolvedValue('pending');
      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'unchanged' });

      expect(effects.grantAccess).not.toHaveBeenCalled();
      expect(githubState()).toBe('invited');
    });

    it('records the customer as a member once they accept', async () => {
      await startAccess('pending');
      effects.membershipOf.mockResolvedValue('active');

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'accepted' });

      expect(memory.state.access.get('ctm_1')).toMatchObject({ githubState: 'active', githubInvitedAt: null });
      expect(effects.grantAccess).not.toHaveBeenCalled();
    });

    it('sends a new invitation once GitHub has dropped the unaccepted one', async () => {
      await startAccess('pending');
      vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
      effects.membershipOf.mockResolvedValue(null); // GitHub drops an invitation after 7 days
      effects.grantAccess.mockResolvedValue('pending');

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'invited' });

      expect(effects.grantAccess).toHaveBeenCalledExactlyOnceWith('octocat');
      expect(memory.state.access.get('ctm_1')).toMatchObject({
        githubState: 'invited',
        githubInvitedAt: new Date('2026-10-09T04:00:00Z'),
      });
    });

    it('invites an entitled customer again after they left or were removed from the team', async () => {
      await startAccess('active');
      effects.membershipOf.mockResolvedValue(null);
      effects.grantAccess.mockResolvedValue('pending');

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'invited' });
      expect(githubState()).toBe('invited');
    });

    it('cancels the pending invitation of a customer who is no longer entitled', async () => {
      effects.automatedProvisioningEnabled.mockReturnValue(false);
      await record({ status: 'revoked' });
      await syncCustomerAccess('ctm_1');
      effects.membershipOf.mockResolvedValue('pending');

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'removed' });
      expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    });

    it('cancels an invitation left pending by a removal that failed after leaving the team', async () => {
      await record({ status: 'revoked' });
      await syncCustomerAccess('ctm_1');
      effects.membershipOf.mockResolvedValue(null);
      effects.hasPendingInvitation.mockResolvedValue(true);

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'removed' });
      expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    });

    it('removes a lapsed customer whose GitHub account was renamed, under its new login', async () => {
      await record({ status: 'revoked' });
      await syncCustomerAccess('ctm_1');
      memory.state.githubUsers.set(1, 'octocat-renamed');
      effects.membershipOf.mockImplementation(async (login: string) => (login === 'octocat-renamed' ? 'active' : null));

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'removed' });
      expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat-renamed');
    });

    it('does nothing for a lapsed customer with neither a membership nor an invitation', async () => {
      await record({ status: 'revoked' });
      await syncCustomerAccess('ctm_1');

      await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'unchanged' });
      expect(effects.hasPendingInvitation).toHaveBeenCalledWith('octocat');
      expect(effects.revokeAccess).not.toHaveBeenCalled();
    });
  });

  it('grants access to a customer who linked GitHub after their access started, only in automated mode', async () => {
    memory.state.githubAccounts.clear();
    await startAccess();
    memory.linkGithub('ctm_1', 'octocat');

    effects.automatedProvisioningEnabled.mockReturnValue(false);
    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'withheld' });
    expect(effects.grantAccess).not.toHaveBeenCalled();

    effects.automatedProvisioningEnabled.mockReturnValue(true);
    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'granted' });
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(githubState()).toBe('active');
  });

  it('removes a customer who is not entitled from the team and revokes licences left live, whatever the mode', async () => {
    effects.automatedProvisioningEnabled.mockReturnValue(false);
    await record({ status: 'revoked' });
    await syncCustomerAccess('ctm_1');
    await memory.store.recordLicence({ customerId: 'ctm_1', jwt: 'left-over' });
    effects.membershipOf.mockResolvedValue('active');

    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'removed', licencesRevoked: true });
    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_1')).toEqual([]);
  });

  it('restores access recorded as ended while a subscription still entitles the customer', async () => {
    await record();
    memory.state.access.set('ctm_1', { status: 'revoked', githubState: 'none', githubInvitedAt: null });

    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ access: 'started', licence: 'issued' });
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
  });

  it('retries a grant that failed, and throws while it keeps failing so the inbox retries the job', async () => {
    effects.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));
    await record();
    await syncCustomerAccess('ctm_1');
    expect(githubState()).toBe('failed');

    effects.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));
    await expect(reconcileCustomer('ctm_1')).rejects.toThrow('GitHub grant failed');

    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ github: 'granted' });
    expect(githubState()).toBe('active');
  });
});
