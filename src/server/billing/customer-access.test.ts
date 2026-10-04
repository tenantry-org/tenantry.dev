import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';
import { grantAndRecord, syncCustomer } from './customer-access';

let deps: FakeBillingDeps;

beforeEach(() => {
  deps = fakeBillingDeps();
  memory.reset();
  memory.state.emails.set('ctm_1', 'buyer@example.com');
  memory.linkGithub('ctm_1', 'octocat');
});

const OCTOBER = new Date('2026-10-01T00:00:00Z');
const NOVEMBER = new Date('2026-11-01T00:00:00Z');
const DECEMBER = new Date('2026-12-01T00:00:00Z');

/** A subscription of ctm_1 as Paddle's newest event left it (status is Paddle's); its period does not matter here. */
interface SubscriptionChange {
  subscriptionId?: string;
  status?: string;
  graceStartedAt?: Date;
  currentPeriodEndsAt?: Date;
}

/** Records a subscription change and syncs the customer, as applying a Paddle event does; returns the change. */
async function entitle({ subscriptionId, status, graceStartedAt }: SubscriptionChange = {}) {
  memory.subscribe('ctm_1', { subscriptionId, status, graceStartedAt });
  return (await syncCustomer('ctm_1', deps)).change;
}

/** Syncs the customer with no new event, as reconcile does; returns what happened to the licence. */
async function reconcileLicence() {
  return (await syncCustomer('ctm_1', deps)).licence;
}

function emailSubjects(): string[] {
  return deps.sendEmail.mock.calls.map(([message]) => message.subject);
}

/** The links in the emails sent, which go to this environment's site (testServerConfig's https://sandbox.example.com). */
function emailLinks(): string[] {
  return deps.sendEmail.mock.calls.flatMap(([message]) =>
    [...message.html.matchAll(/<a href="([^"]+)" style="display/g)].map(([, href]) => href),
  );
}

describe('syncCustomer', () => {
  it('grants access, issues a licence and welcomes the customer when access starts', async () => {
    await expect(entitle()).resolves.toBe('started');

    expect(deps.github.grantAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({
      status: 'active',
      githubState: 'active',
      githubInvitedAt: null,
    });
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Welcome to Tenantry Pro: create a feed token to install it']);
    expect(emailLinks()).toEqual(['https://sandbox.example.com/dashboard/pro']);
  });

  it('removes a renamed GitHub account under its new login when access ends, and records the new login', async () => {
    await entitle();
    memory.state.githubUsers.set(1, 'octocat-renamed'); // renamed on GitHub; github_links still says octocat

    await expect(entitle({ status: 'canceled' })).resolves.toBe('ended');

    expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat-renamed');
    expect(memory.state.githubAccounts.get('ctm_1')).toEqual({ id: 1, login: 'octocat-renamed' });
  });

  it('grants nothing to whoever takes the login of a deleted GitHub account', async () => {
    memory.state.githubUsers.delete(1);

    await expect(entitle()).resolves.toBe('started');

    expect(deps.github.grantAccess).not.toHaveBeenCalled();
  });

  it('keeps the one licence through repeated events, renewals and other subscriptions: it does not expire', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.clearAllMocks();

    await expect(entitle()).resolves.toBe('unchanged');
    // Renewal: the billing period moves on. More subscriptions start and one is cancelled.
    await entitle({ currentPeriodEndsAt: NOVEMBER });
    await entitle({ subscriptionId: 'sub_2', currentPeriodEndsAt: OCTOBER });
    await entitle({ subscriptionId: 'sub_3', currentPeriodEndsAt: DECEMBER });
    await expect(entitle({ subscriptionId: 'sub_3', status: 'canceled' })).resolves.toBe('unchanged');

    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.issueLicence).not.toHaveBeenCalled();
    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'active' });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps access while a subscription is in grace, and ends it with the last entitled subscription', async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2' });
    vi.clearAllMocks();

    await expect(entitle({ status: 'past_due', graceStartedAt: new Date() })).resolves.toBe('unchanged');
    await expect(entitle({ subscriptionId: 'sub_2', status: 'canceled' })).resolves.toBe('unchanged');
    expect(memory.state.access.get('ctm_1')).toMatchObject({
      status: 'grace',
      githubState: 'active',
      githubInvitedAt: null,
    });
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();

    await expect(entitle({ status: 'canceled' })).resolves.toBe('ended');
    expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'lapsed', githubState: 'none', githubInvitedAt: null });
    // The key is kept: it does not decide which releases they may use, and they may keep using the vested ones.
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
    expect(emailLinks()).toEqual(['https://sandbox.example.com/#pricing']);
  });

  it('does nothing for a customer whose only subscription never entitled them', async () => {
    await expect(entitle({ status: 'canceled' })).resolves.toBe('unchanged');

    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('in manual mode records access but grants nothing, and still ends access and says so', async () => {
    deps.config = testServerConfig({ provisioning: 'manual' });

    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'active', githubState: 'none', githubInvitedAt: null });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(memory.licences('ctm_1')).toEqual([]);
    expect(deps.sendEmail).not.toHaveBeenCalled();

    await expect(entitle({ status: 'canceled' })).resolves.toBe('ended');
    expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('leaves the grant pending for a customer who has not linked GitHub, but issues the licence', async () => {
    memory.state.githubAccounts.clear();

    await expect(entitle()).resolves.toBe('started');

    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(memory.state.access.get('ctm_1')?.githubState).toBe('none');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(deps.sendEmail).toHaveBeenCalledOnce();
  });

  it('carries on when the GitHub grant fails, leaving it for reconcile', async () => {
    deps.github.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(entitle()).resolves.toBe('started');

    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'active', githubState: 'failed' });
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(deps.sendEmail).toHaveBeenCalledOnce();
  });

  it('alerts the operator on the first failed grant only, and again after a success', async () => {
    const alerts = () => deps.alertOperator.mock.calls.map(([subject]) => subject);
    deps.github.grantAccess.mockRejectedValue(new Error('GitHub unavailable'));

    await entitle();
    expect(alerts()).toEqual(['GitHub grant failed for customer ctm_1']);
    expect(deps.alertOperator).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('octocat'));

    // Reconcile's retries keep failing: no further alert.
    await expect(grantAndRecord('ctm_1', 'octocat', deps)).resolves.toBe('failed');
    await expect(grantAndRecord('ctm_1', 'octocat', deps)).resolves.toBe('failed');
    expect(alerts()).toHaveLength(1);

    // A retry succeeds; a later failure is a new problem and alerts again.
    deps.github.grantAccess.mockResolvedValueOnce('active');
    await expect(grantAndRecord('ctm_1', 'octocat', deps)).resolves.toBe('active');
    await expect(grantAndRecord('ctm_1', 'octocat', deps)).resolves.toBe('failed');
    expect(alerts()).toHaveLength(2);
  });

  it('records nothing when reading the subscriptions fails, so the event is retried whole', async () => {
    vi.spyOn(deps.store, 'listSubscriptions').mockRejectedValueOnce(new Error('database unavailable'));

    await expect(entitle()).rejects.toThrow('database unavailable');
    expect(memory.state.access.size).toBe(0);

    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'started' });
    expect(deps.github.grantAccess).toHaveBeenCalledOnce();
  });
});

describe('licence issuance failures', () => {
  const alerts = () => deps.alertOperator.mock.calls.map(([subject, detail]) => ({ subject, detail }));
  const failSigning = (message: string) =>
    deps.issueLicence.mockImplementation(() => {
      throw new Error(message);
    });
  // Back to the fake's own signing.
  const repairSigning = () => deps.issueLicence.mockReset();

  it('records a signing failure, alerts once, and issues the licence on reconcile once the key is repaired', async () => {
    failSigning('error:1E08010C:DECODER routines::unsupported');

    // The purchase: access starts, but the licence cannot be signed.
    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.licences('ctm_1')).toEqual([]);
    expect(memory.state.licenceFailures.get('ctm_1')).toEqual({
      attempts: 1,
      lastError: 'error:1E08010C:DECODER routines::unsupported',
    });
    expect(alerts()).toEqual([expect.objectContaining({ subject: 'Licence issuance failed for customer ctm_1' })]);

    // Reconcile retries while the key is still broken: recorded, but no second alert.
    await expect(reconcileLicence()).resolves.toBe('failed');
    expect(memory.state.licenceFailures.get('ctm_1')?.attempts).toBe(2);
    expect(alerts()).toHaveLength(1);

    // The key is repaired; the next reconcile issues the licence, with no new purchase or event.
    repairSigning();
    await expect(reconcileLicence()).resolves.toBe('issued');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(memory.state.licenceFailures.has('ctm_1')).toBe(false);

    await expect(reconcileLicence()).resolves.toBe('current');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
  });

  it('treats a failure to store the licence the same way, recording the database error message', async () => {
    // Supabase reports errors as plain objects, not Error instances.
    vi.spyOn(deps.store, 'recordLicence').mockRejectedValueOnce({
      code: 'P0001',
      message: 'licence storage unavailable',
    });

    await entitle();
    expect(memory.state.licenceFailures.get('ctm_1')?.lastError).toBe('licence storage unavailable');
    expect(alerts()[0].detail).toContain('licence storage unavailable');
    expect(alerts()).toHaveLength(1);

    await expect(reconcileLicence()).resolves.toBe('issued');
    expect(memory.state.licenceFailures.size).toBe(0);
  });

  it('signs nothing for a returning customer, who keeps the licence issued after the first failures', async () => {
    failSigning('signing failed');
    await entitle();
    await reconcileLicence();
    expect(alerts()).toHaveLength(1);

    repairSigning();
    await expect(reconcileLicence()).resolves.toBe('issued');
    const [licence] = memory.licences('ctm_1');

    // The customer leaves and subscribes again while signing is broken: they keep their key, so nothing fails.
    await entitle({ status: 'canceled' });
    failSigning('signing failed');
    await entitle();

    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(memory.state.licenceFailures.has('ctm_1')).toBe(false);
    expect(alerts()).toHaveLength(1);
  });

  it('alerts even when the failure cannot be recorded', async () => {
    failSigning('signing failed');
    vi.spyOn(deps.store, 'recordLicenceFailure').mockRejectedValue(new Error('database unavailable'));

    await entitle();
    await reconcileLicence();

    expect(alerts()).toHaveLength(2);
  });

  it('forgets the failures when access ends', async () => {
    failSigning('signing failed');
    await entitle();

    await entitle({ status: 'canceled' });

    expect(memory.state.licenceFailures.size).toBe(0);
    await expect(reconcileLicence()).resolves.toBeNull();
  });
});

describe('grace period', () => {
  const PAST_DUE = new Date('2026-10-01T00:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The renewal on 1 October fails: Paddle moves the subscription into its next billing period, unpaid.
  const pastDue = { status: 'past_due', graceStartedAt: PAST_DUE, currentPeriodEndsAt: NOVEMBER };

  it('keeps access and the licence within grace', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.clearAllMocks();
    vi.setSystemTime(PAST_DUE);

    await expect(entitle(pastDue)).resolves.toBe('unchanged');

    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'grace', githubState: 'active', githubInvitedAt: null });
    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();

    // Reconcile during grace changes nothing.
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'unchanged', licence: 'current' });
  });

  it('ends access when grace is over, with no event from Paddle', async () => {
    await entitle();
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    // The daily reconcile after grace has ended.
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'ended', licence: null });

    expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toEqual({ status: 'lapsed', githubState: 'none', githubInvitedAt: null });
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('restores active access, with the same licence, when the payment is recovered within grace', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    await expect(entitle({ status: 'active', currentPeriodEndsAt: NOVEMBER })).resolves.toBe('unchanged');

    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();

    // Grace no longer applies: the recovered subscription stays entitled after the old grace end.
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'unchanged' });
  });

  it("keeps access through another subscription when one subscription's grace ends", async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2', currentPeriodEndsAt: NOVEMBER });
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'unchanged' });

    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('starts access again, with the same licence, when a payment is recovered after grace ended', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await syncCustomer('ctm_1', deps);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    await expect(entitle({ status: 'active', currentPeriodEndsAt: new Date('2026-12-01T00:00:00Z') })).resolves.toBe(
      'started',
    );
    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.issueLicence).not.toHaveBeenCalled();
  });
});
