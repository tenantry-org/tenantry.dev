import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementRecord } from '@/utils/entitlements/entitlements-store';
import { memory } from '@/utils/testing/memory-entitlements';
import { syncCustomerAccess } from './customer-access';
import { reconcileCustomer } from './reconcile-customer';

const effects = vi.hoisted(() => ({
  grantAccess: vi.fn(),
  revokeAccess: vi.fn(),
  hasAccess: vi.fn(),
  sendEmail: vi.fn(),
  provisioningAllowed: vi.fn(),
}));
vi.mock('@/utils/github/provisioning', () => ({
  grantAccess: effects.grantAccess,
  revokeAccess: effects.revokeAccess,
  hasAccess: effects.hasAccess,
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

async function record(overrides: Partial<EntitlementRecord> = {}) {
  await memory.store.upsertEntitlement({
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
    tier: 'pro',
    status: 'active',
    currentPeriodEndsAt: NOVEMBER,
    graceStartedAt: null,
    ...overrides,
  });
}

describe('reconcileCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:10:00Z'));
    effects.provisioningAllowed.mockReturnValue(true);
    effects.hasAccess.mockResolvedValue(false);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.state.githubLogins.set('ctm_1', 'octocat');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends access once the grace period is over, with no event from Paddle', async () => {
    await record();
    await syncCustomerAccess('ctm_1');
    await record({ status: 'grace', graceStartedAt: OCTOBER });
    await syncCustomerAccess('ctm_1');
    vi.clearAllMocks();
    effects.hasAccess.mockResolvedValue(false); // already removed by the sync

    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ access: 'ended' });

    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(effects.sendEmail).toHaveBeenCalledOnce();
  });

  it('changes nothing for an entitled customer whose GitHub access and licence are in place', async () => {
    await record();
    await syncCustomerAccess('ctm_1');
    vi.clearAllMocks();

    await expect(reconcileCustomer('ctm_1')).resolves.toEqual({
      access: 'unchanged',
      licence: 'current',
      githubGranted: false,
      githubRemoved: false,
      licencesRevoked: false,
    });
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('grants access to a customer who linked GitHub after their access started, only in automated mode', async () => {
    memory.state.githubLogins.clear();
    await record();
    await syncCustomerAccess('ctm_1');
    memory.state.githubLogins.set('ctm_1', 'octocat');

    effects.provisioningAllowed.mockReturnValue(false);
    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ githubGranted: false });
    expect(effects.grantAccess).not.toHaveBeenCalled();

    effects.provisioningAllowed.mockReturnValue(true);
    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ githubGranted: true });
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_1')?.githubGranted).toBe(true);
  });

  it('removes a customer who is not entitled from the team and revokes licences left live, whatever the mode', async () => {
    effects.provisioningAllowed.mockReturnValue(false);
    await record({ status: 'revoked' });
    await syncCustomerAccess('ctm_1');
    await memory.store.recordLicence({ customerId: 'ctm_1', jwt: 'left-over', tier: 'pro', expiresAt: NOVEMBER });
    effects.hasAccess.mockResolvedValue(true);

    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ githubRemoved: true, licencesRevoked: true });
    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_1')).toEqual([]);
  });

  it('restores access recorded as ended while a subscription still entitles the customer', async () => {
    await record();
    memory.state.access.set('ctm_1', { status: 'revoked', tier: null, githubGranted: false });

    await expect(reconcileCustomer('ctm_1')).resolves.toMatchObject({ access: 'started', licence: 'issued' });
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
  });

  it('throws when a step fails, so the inbox retries the job', async () => {
    await record();
    await syncCustomerAccess('ctm_1');
    memory.state.access.set('ctm_1', { status: 'active', tier: 'pro', githubGranted: false });
    effects.grantAccess.mockRejectedValue(new Error('GitHub unavailable'));

    await expect(reconcileCustomer('ctm_1')).rejects.toThrow('GitHub unavailable');
  });
});
