import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { EntitlementRecord } from '@/utils/entitlements/entitlements-store';
import { memory } from '@/utils/testing/memory-entitlements';
import { aggregateAccess, grantAndRecord, syncCustomerAccess } from './customer-access';

const effects = vi.hoisted(() => ({
  grantAccess: vi.fn().mockResolvedValue('active'),
  revokeAccess: vi.fn(),
  sendEmail: vi.fn(),
  automatedProvisioningEnabled: vi.fn(),
  issueLicence: vi.fn(),
}));
vi.mock('@/utils/github/provisioning', async () => {
  const { memory } = await import('@/utils/testing/memory-entitlements');
  return {
    grantAccess: effects.grantAccess,
    revokeAccess: effects.revokeAccess,
    currentLogin: memory.currentLogin,
  };
});
vi.mock('@/utils/entitlements/entitlements-store', async () => {
  const { memory } = await import('@/utils/testing/memory-entitlements');
  return memory.store;
});
vi.mock('@/utils/email/send', () => ({ sendEmail: effects.sendEmail }));
vi.mock('@/utils/licensing/licence-issuer', () => ({ issueLicence: effects.issueLicence }));

let licencesSigned = 0;
function signLicence({ customerId }: { customerId: string }) {
  licencesSigned += 1;
  return `licence:${customerId}:${licencesSigned}`;
}
vi.mock('@/utils/provisioning-guard', () => ({ automatedProvisioningEnabled: effects.automatedProvisioningEnabled }));

const OCTOBER = new Date('2026-10-01T00:00:00Z');
const NOVEMBER = new Date('2026-11-01T00:00:00Z');
const DECEMBER = new Date('2026-12-01T00:00:00Z');

function entitlement(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
    status: 'active',
    currentPeriodEndsAt: OCTOBER,
    graceStartedAt: null,
    ...overrides,
  };
}

/** Records an entitlement change and syncs the customer, as the webhook worker does; returns the change. */
async function entitle(overrides: Partial<EntitlementRecord> = {}) {
  await memory.store.upsertEntitlement(entitlement(overrides));
  return (await syncCustomerAccess('ctm_1')).change;
}

/** Syncs the customer with no new event, as reconcile does; returns what happened to the licence. */
async function reconcileLicence() {
  return (await syncCustomerAccess('ctm_1')).licence;
}

function emailSubjects(): string[] {
  return effects.sendEmail.mock.calls.map(([message]) => message.subject);
}

describe('aggregateAccess', () => {
  it('is revoked when no subscription entitles the customer', () => {
    expect(aggregateAccess([])).toBe('revoked');
    expect(aggregateAccess([entitlement({ status: 'revoked' })])).toBe('revoked');
  });

  it('is active if any subscription is active, and grace if the only entitled ones are in grace', () => {
    expect(aggregateAccess([entitlement({ status: 'grace' }), entitlement({ status: 'revoked' })])).toBe('grace');
    expect(aggregateAccess([entitlement({ status: 'grace' }), entitlement({ status: 'active' })])).toBe('active');
  });
});

describe('syncCustomerAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    effects.automatedProvisioningEnabled.mockReturnValue(true);
    effects.issueLicence.mockImplementation(signLicence);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.linkGithub('ctm_1', 'octocat');
  });

  it('grants access, issues a licence and welcomes the customer when access starts', async () => {
    await expect(entitle()).resolves.toBe('started');

    expect(effects.grantAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({
      status: 'active',
      githubState: 'active',
      githubInvitedAt: null,
    });
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Welcome to Tenantry Pro — connect GitHub to get access']);
  });

  it('removes a renamed GitHub account under its new login when access ends, and records the new login', async () => {
    await entitle();
    memory.state.githubUsers.set(1, 'octocat-renamed'); // renamed on GitHub; github_links still says octocat

    await expect(entitle({ status: 'revoked' })).resolves.toBe('ended');

    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat-renamed');
    expect(memory.state.githubAccounts.get('ctm_1')).toEqual({ id: 1, login: 'octocat-renamed' });
  });

  it('grants nothing to whoever takes the login of a deleted GitHub account', async () => {
    memory.state.githubUsers.delete(1);

    await expect(entitle()).resolves.toBe('started');

    expect(effects.grantAccess).not.toHaveBeenCalled();
  });

  it('keeps the one licence through repeated events, renewals and other subscriptions: it does not expire', async () => {
    await entitle();
    const [licence] = memory.liveLicences('ctm_1');
    vi.clearAllMocks();

    await expect(entitle()).resolves.toBe('unchanged');
    // Renewal: the billing period moves on. More subscriptions start and one is cancelled.
    await entitle({ currentPeriodEndsAt: NOVEMBER });
    await entitle({ subscriptionId: 'sub_2', currentPeriodEndsAt: OCTOBER });
    await entitle({ subscriptionId: 'sub_3', currentPeriodEndsAt: DECEMBER });
    await expect(entitle({ subscriptionId: 'sub_3', status: 'revoked' })).resolves.toBe('unchanged');

    expect(memory.liveLicences('ctm_1')).toEqual([licence]);
    expect(effects.issueLicence).not.toHaveBeenCalled();
    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'active' });
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps access while a subscription is in grace, and ends it with the last entitled subscription', async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2' });
    vi.clearAllMocks();

    await expect(entitle({ status: 'grace', graceStartedAt: new Date() })).resolves.toBe('unchanged');
    await expect(entitle({ subscriptionId: 'sub_2', status: 'revoked' })).resolves.toBe('unchanged');
    expect(memory.state.access.get('ctm_1')).toMatchObject({
      status: 'grace',
      githubState: 'active',
      githubInvitedAt: null,
    });
    expect(effects.revokeAccess).not.toHaveBeenCalled();

    await expect(entitle({ status: 'revoked' })).resolves.toBe('ended');
    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'revoked', githubState: 'none', githubInvitedAt: null });
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('does nothing for a customer whose only subscription never entitled them', async () => {
    await expect(entitle({ status: 'revoked' })).resolves.toBe('unchanged');

    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('in manual mode records access but grants nothing, and still ends access and says so', async () => {
    effects.automatedProvisioningEnabled.mockReturnValue(false);

    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'active', githubState: 'none', githubInvitedAt: null });
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(effects.sendEmail).not.toHaveBeenCalled();

    await expect(entitle({ status: 'revoked' })).resolves.toBe('ended');
    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('leaves the grant pending for a customer who has not linked GitHub, but issues the licence', async () => {
    memory.state.githubAccounts.clear();

    await expect(entitle()).resolves.toBe('started');

    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(memory.state.access.get('ctm_1')?.githubState).toBe('none');
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(effects.sendEmail).toHaveBeenCalledOnce();
  });

  it('carries on when the GitHub grant fails, leaving it for reconcile', async () => {
    effects.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(entitle()).resolves.toBe('started');

    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'active', githubState: 'failed' });
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(effects.sendEmail).toHaveBeenCalledOnce();
  });

  it('alerts the operator on the first failed grant only, and again after a success', async () => {
    vi.stubEnv('ALERT_EMAIL', 'ops@example.com');
    const alerts = () => emailSubjects().filter((subject) => subject.startsWith('[Tenantry alert]'));
    effects.grantAccess.mockRejectedValue(new Error('GitHub unavailable'));
    onTestFinished(() => {
      effects.grantAccess.mockResolvedValue('active');
      vi.unstubAllEnvs();
    });

    await entitle();
    expect(alerts()).toEqual(['[Tenantry alert] GitHub grant failed for customer ctm_1']);
    expect(effects.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining('octocat') }),
    );

    // Reconcile's retries keep failing: no further alert.
    await expect(grantAndRecord('ctm_1', 'octocat')).resolves.toBe('failed');
    await expect(grantAndRecord('ctm_1', 'octocat')).resolves.toBe('failed');
    expect(alerts()).toHaveLength(1);

    // A retry succeeds; a later failure is a new problem and alerts again.
    effects.grantAccess.mockResolvedValueOnce('active');
    await expect(grantAndRecord('ctm_1', 'octocat')).resolves.toBe('active');
    await expect(grantAndRecord('ctm_1', 'octocat')).resolves.toBe('failed');
    expect(alerts()).toHaveLength(2);
  });

  it('records nothing when reading the entitlements fails, so the event is retried whole', async () => {
    const listEntitlements = vi.spyOn(memory.store, 'listEntitlements');
    listEntitlements.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(entitle()).rejects.toThrow('database unavailable');
    expect(memory.state.access.size).toBe(0);

    await expect(syncCustomerAccess('ctm_1')).resolves.toMatchObject({ change: 'started' });
    expect(effects.grantAccess).toHaveBeenCalledOnce();
    listEntitlements.mockRestore();
  });
});

describe('licence issuance failures', () => {
  const alerts = () =>
    effects.sendEmail.mock.calls.filter(([message]) => message.to === 'ops@example.com').map(([message]) => message);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ALERT_EMAIL', 'ops@example.com');
    effects.automatedProvisioningEnabled.mockReturnValue(true);
    effects.issueLicence.mockImplementation(signLicence);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.linkGithub('ctm_1', 'octocat');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records a signing failure, alerts once, and issues the licence on reconcile once the key is repaired', async () => {
    effects.issueLicence.mockImplementation(() => {
      throw new Error('error:1E08010C:DECODER routines::unsupported');
    });

    // The purchase: access starts, but the licence cannot be signed.
    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(memory.state.licenceFailures.get('ctm_1')).toEqual({
      attempts: 1,
      lastError: 'error:1E08010C:DECODER routines::unsupported',
    });
    expect(alerts()).toEqual([
      expect.objectContaining({ subject: '[Tenantry alert] Licence issuance failed for customer ctm_1' }),
    ]);

    // Reconcile retries while the key is still broken: recorded, but no second alert.
    await expect(reconcileLicence()).resolves.toBe('failed');
    expect(memory.state.licenceFailures.get('ctm_1')?.attempts).toBe(2);
    expect(alerts()).toHaveLength(1);

    // The key is repaired; the next reconcile issues the licence, with no new purchase or event.
    effects.issueLicence.mockImplementation(signLicence);
    await expect(reconcileLicence()).resolves.toBe('issued');
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(memory.state.licenceFailures.has('ctm_1')).toBe(false);

    await expect(reconcileLicence()).resolves.toBe('current');
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
  });

  it('treats a failure to store the licence the same way, recording the database error message', async () => {
    // Supabase reports errors as plain objects, not Error instances.
    const recordLicence = vi
      .spyOn(memory.store, 'recordLicence')
      .mockRejectedValueOnce({ code: 'P0001', message: 'licence storage unavailable' });

    await entitle();
    expect(memory.state.licenceFailures.get('ctm_1')?.lastError).toBe('licence storage unavailable');
    expect(alerts()[0].html).toContain('licence storage unavailable');
    expect(alerts()).toHaveLength(1);

    await expect(reconcileLicence()).resolves.toBe('issued');
    expect(memory.state.licenceFailures.size).toBe(0);
    recordLicence.mockRestore();
  });

  it('alerts again for a new run of failures after a licence was issued', async () => {
    const failSigning = () =>
      effects.issueLicence.mockImplementation(() => {
        throw new Error('signing failed');
      });
    failSigning();
    await entitle();
    await reconcileLicence();
    expect(alerts()).toHaveLength(1);

    effects.issueLicence.mockImplementation(signLicence);
    await expect(reconcileLicence()).resolves.toBe('issued');

    // The customer leaves and subscribes again; their new licence cannot be issued either.
    await entitle({ status: 'revoked' });
    failSigning();
    await entitle();

    expect(alerts()).toHaveLength(2);
  });

  it('alerts even when the failure cannot be recorded', async () => {
    effects.issueLicence.mockImplementation(() => {
      throw new Error('signing failed');
    });
    const recordFailure = vi
      .spyOn(memory.store, 'recordLicenceFailure')
      .mockRejectedValue(new Error('database unavailable'));

    await entitle();
    await reconcileLicence();

    expect(alerts()).toHaveLength(2);
    recordFailure.mockRestore();
  });

  it('forgets the failures when access ends', async () => {
    effects.issueLicence.mockImplementation(() => {
      throw new Error('signing failed');
    });
    await entitle();

    await entitle({ status: 'revoked' });

    expect(memory.state.licenceFailures.size).toBe(0);
    await expect(reconcileLicence()).resolves.toBeNull();
  });
});

describe('grace period', () => {
  const PAST_DUE = new Date('2026-10-01T00:00:00Z');
  const GRACE_ENDS = new Date('2026-10-31T00:00:00Z'); // 30 days later

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    effects.automatedProvisioningEnabled.mockReturnValue(true);
    effects.issueLicence.mockImplementation(signLicence);
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.linkGithub('ctm_1', 'octocat');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The renewal on 1 October fails: Paddle moves the subscription into its next billing period, unpaid.
  const pastDue = { status: 'grace' as const, graceStartedAt: PAST_DUE, currentPeriodEndsAt: NOVEMBER };

  it('counts a subscription in grace until its grace period ends', () => {
    const grace = entitlement(pastDue);

    expect(aggregateAccess([grace], new Date('2026-10-30T23:59:59Z'))).toBe('grace');
    expect(aggregateAccess([grace], GRACE_ENDS)).toBe('revoked');
    expect(aggregateAccess([grace, entitlement({ subscriptionId: 'sub_2' })], GRACE_ENDS)).toBe('active');
  });

  it('keeps access and the licence within grace', async () => {
    await entitle();
    const [licence] = memory.liveLicences('ctm_1');
    vi.clearAllMocks();
    vi.setSystemTime(PAST_DUE);

    await expect(entitle(pastDue)).resolves.toBe('unchanged');

    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'grace', githubState: 'active', githubInvitedAt: null });
    expect(memory.liveLicences('ctm_1')).toEqual([licence]);
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();

    // Reconcile during grace changes nothing.
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    await expect(syncCustomerAccess('ctm_1')).resolves.toEqual({ change: 'unchanged', licence: 'current' });
  });

  it('ends access when grace is over, with no event from Paddle', async () => {
    await entitle();
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    // The daily reconcile after grace has ended.
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomerAccess('ctm_1')).resolves.toEqual({ change: 'ended', licence: null });

    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'revoked', githubState: 'none', githubInvitedAt: null });
    expect(memory.liveLicences('ctm_1')).toEqual([]);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('restores active access, with the same licence, when the payment is recovered within grace', async () => {
    await entitle();
    const [licence] = memory.liveLicences('ctm_1');
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    await expect(entitle({ status: 'active', currentPeriodEndsAt: NOVEMBER })).resolves.toBe('unchanged');

    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
    expect(memory.liveLicences('ctm_1')).toEqual([licence]);
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();

    // Grace no longer applies: the recovered subscription stays entitled after the old grace end.
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomerAccess('ctm_1')).resolves.toMatchObject({ change: 'unchanged' });
  });

  it("keeps access through another subscription when one subscription's grace ends", async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2', currentPeriodEndsAt: NOVEMBER });
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomerAccess('ctm_1')).resolves.toMatchObject({ change: 'unchanged' });

    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('starts access again when a payment is recovered after grace ended', async () => {
    await entitle();
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await syncCustomerAccess('ctm_1');
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    await expect(entitle({ status: 'active', currentPeriodEndsAt: new Date('2026-12-01T00:00:00Z') })).resolves.toBe(
      'started',
    );
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_1')).toHaveLength(1);
  });
});
