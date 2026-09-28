import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementRecord } from '@/utils/entitlements/entitlements-store';
import { memory } from '@/utils/testing/memory-entitlements';
import { aggregateAccess, syncCustomerAccess } from './customer-access';

const effects = vi.hoisted(() => ({
  grantAccess: vi.fn(),
  revokeAccess: vi.fn(),
  sendEmail: vi.fn(),
  provisioningAllowed: vi.fn(),
}));
vi.mock('@/utils/github/provisioning', () => ({
  grantAccess: effects.grantAccess,
  revokeAccess: effects.revokeAccess,
}));
vi.mock('@/utils/entitlements/entitlements-store', async () => {
  const { memory } = await import('@/utils/testing/memory-entitlements');
  return memory.store;
});
vi.mock('@/utils/email/send', () => ({ sendEmail: effects.sendEmail }));
vi.mock('@/utils/licensing/licence-issuer', () => ({
  issueLicence: ({ tier, expiresAt }: { tier: string; expiresAt: Date }) => `${tier}:${expiresAt.toISOString()}`,
}));
vi.mock('@/utils/provisioning-guard', () => ({ provisioningAllowed: effects.provisioningAllowed }));

const OCTOBER = new Date('2026-10-01T00:00:00Z');
const NOVEMBER = new Date('2026-11-01T00:00:00Z');

function entitlement(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
    tier: 'pro',
    status: 'active',
    currentPeriodEndsAt: OCTOBER,
    ...overrides,
  };
}

async function entitle(overrides: Partial<EntitlementRecord> = {}) {
  await memory.store.upsertEntitlement(entitlement(overrides));
  return syncCustomerAccess('ctm_1');
}

function emailSubjects(): string[] {
  return effects.sendEmail.mock.calls.map(([message]) => message.subject);
}

describe('aggregateAccess', () => {
  it('is revoked when no subscription entitles the customer', () => {
    expect(aggregateAccess([])).toEqual({ status: 'revoked', tier: null, licenceExpiresAt: null });
    expect(aggregateAccess([entitlement({ status: 'revoked' })]).status).toBe('revoked');
  });

  it('is active if any subscription is active, and grace if the only entitled ones are in grace', () => {
    expect(aggregateAccess([entitlement({ status: 'grace' }), entitlement({ status: 'revoked' })]).status).toBe(
      'grace',
    );
    expect(aggregateAccess([entitlement({ status: 'grace' }), entitlement({ status: 'active' })]).status).toBe(
      'active',
    );
  });

  it('takes the highest tier and latest billing period among the entitled subscriptions only', () => {
    const access = aggregateAccess([
      entitlement({ tier: 'starter', currentPeriodEndsAt: OCTOBER }),
      entitlement({ tier: 'advanced', status: 'revoked', currentPeriodEndsAt: new Date('2027-01-01T00:00:00Z') }),
      entitlement({ tier: 'pro', status: 'grace', currentPeriodEndsAt: NOVEMBER }),
    ]);

    expect(access).toEqual({ status: 'active', tier: 'pro', licenceExpiresAt: NOVEMBER });
  });

  it('has no licence expiry when Paddle gave no billing period', () => {
    expect(aggregateAccess([entitlement({ currentPeriodEndsAt: null })]).licenceExpiresAt).toBeNull();
  });
});

describe('syncCustomerAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effects.provisioningAllowed.mockReturnValue(true);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.state.githubLogins.set('ctm_1', 'octocat');
  });

  it('grants access, issues a licence and welcomes the customer when access starts', async () => {
    await expect(entitle()).resolves.toBe('started');

    expect(effects.grantAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'active', tier: 'pro', githubGranted: true });
    expect(memory.liveLicences('ctm_1')).toMatchObject([{ tier: 'pro', expiresAt: OCTOBER }]);
    expect(emailSubjects()).toEqual(['Welcome to Tenantry Pro — connect GitHub to get access']);
  });

  it('changes nothing for a repeated event, and re-issues the licence only when its tier or expiry changes', async () => {
    await entitle();
    vi.clearAllMocks();

    await expect(entitle()).resolves.toBe('unchanged');
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);

    // Renewal: the billing period moves on.
    await entitle({ currentPeriodEndsAt: NOVEMBER });
    // Upgrade through a second subscription.
    await entitle({ subscriptionId: 'sub_2', tier: 'advanced', currentPeriodEndsAt: OCTOBER });

    expect(memory.liveLicences('ctm_1').map((licence) => licence.jwt)).toEqual([
      'pro:2026-10-01T00:00:00.000Z',
      'pro:2026-11-01T00:00:00.000Z',
      'advanced:2026-11-01T00:00:00.000Z',
    ]);
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();

    // Cancelling the upgrade keeps access, at the remaining tier.
    await expect(entitle({ subscriptionId: 'sub_2', tier: 'advanced', status: 'revoked' })).resolves.toBe('unchanged');
    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'active', tier: 'pro' });
    expect(memory.liveLicences('ctm_1').at(-1)).toMatchObject({ tier: 'pro', expiresAt: NOVEMBER });
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps access while a subscription is in grace, and ends it with the last entitled subscription', async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2' });
    vi.clearAllMocks();

    await expect(entitle({ status: 'grace' })).resolves.toBe('unchanged');
    await expect(entitle({ subscriptionId: 'sub_2', status: 'revoked' })).resolves.toBe('unchanged');
    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'grace', githubGranted: true });
    expect(effects.revokeAccess).not.toHaveBeenCalled();

    await expect(entitle({ status: 'revoked' })).resolves.toBe('ended');
    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'revoked', tier: null, githubGranted: false });
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('does nothing for a customer whose only subscription never entitled them', async () => {
    await expect(entitle({ status: 'revoked' })).resolves.toBe('unchanged');

    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('in manual mode records access but grants nothing, and still ends access and says so', async () => {
    effects.provisioningAllowed.mockReturnValue(false);

    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'active', tier: 'pro', githubGranted: false });
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(effects.sendEmail).not.toHaveBeenCalled();

    await expect(entitle({ status: 'revoked' })).resolves.toBe('ended');
    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('leaves the grant pending for a customer who has not linked GitHub, but issues the licence', async () => {
    memory.state.githubLogins.clear();

    await expect(entitle()).resolves.toBe('started');

    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(memory.state.access.get('ctm_1')?.githubGranted).toBe(false);
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(effects.sendEmail).toHaveBeenCalledOnce();
  });

  it('carries on when the GitHub grant fails, leaving it for reconcile', async () => {
    effects.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(entitle()).resolves.toBe('started');

    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'active', githubGranted: false });
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(effects.sendEmail).toHaveBeenCalledOnce();
  });

  it('records nothing when reading the entitlements fails, so the event is retried whole', async () => {
    const listEntitlements = vi.spyOn(memory.store, 'listEntitlements');
    listEntitlements.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(entitle()).rejects.toThrow('database unavailable');
    expect(memory.state.access.size).toBe(0);

    await expect(syncCustomerAccess('ctm_1')).resolves.toBe('started');
    expect(effects.grantAccess).toHaveBeenCalledOnce();
    listEntitlements.mockRestore();
  });
});
