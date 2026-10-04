import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';
import { Webhooks } from '@paddle/paddle-node-sdk';
import { transactionEvent } from '@/test/paddle-events';
import type { PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import { syncCustomer } from './customer-access';
import { reconcileCustomer, resetRecoveryAlerts } from './reconcile-customer';

let deps: FakeBillingDeps;

const OCTOBER = new Date('2026-10-01T00:00:00Z');

/** Sets ctm_1's subscription as Paddle's newest event left it (status is Paddle's). */
async function record({ status, graceStartedAt }: { status?: string; graceStartedAt?: Date } = {}) {
  memory.subscribe('ctm_1', { status, graceStartedAt });
}

/** Starts the customer's access as the webhook does; GitHub answers the grant with `membership`. */
async function startAccess(membership: 'active' | 'pending' = 'active') {
  deps.github.grantAccess.mockResolvedValueOnce(membership);
  await record();
  await syncCustomer('ctm_1', deps);
  vi.clearAllMocks();
}

const githubState = () => memory.state.access.get('ctm_1')?.githubState;

describe('reconcileCustomer', () => {
  beforeEach(() => {
    deps = fakeBillingDeps();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:10:00Z'));
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
    memory.linkGithub('ctm_1', 'octocat');
    resetRecoveryAlerts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends access once the grace period is over, with no event from Paddle', async () => {
    await startAccess();
    await record({ status: 'past_due', graceStartedAt: OCTOBER });
    await syncCustomer('ctm_1', deps);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ access: 'ended' });

    expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_1')).toMatchObject({ status: 'lapsed', githubState: 'none' });
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(deps.sendEmail).toHaveBeenCalledOnce();
  });

  it('changes nothing for an entitled member whose licence is in place', async () => {
    await startAccess('active');
    deps.github.membershipOf.mockResolvedValue('active');

    await expect(reconcileCustomer('ctm_1', deps)).resolves.toEqual({
      access: 'unchanged',
      licence: 'current',
      github: 'unchanged',
      paymentsRecovered: 0,
    });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  describe('payments whose notification was lost', () => {
    // A completed Pro renewal of sub_1, as Paddle's API lists it: the same entity the notification carries.
    const listed = (transactionId: string, startsAt: string, endsAt: string, productId = 'pro_01') =>
      Webhooks.fromJson(
        transactionEvent({
          eventId: `evt_${transactionId}`,
          transactionId,
          customerId: 'ctm_1',
          subscriptionId: 'sub_1',
          productId,
          occurredAt: startsAt,
          period: { startsAt, endsAt },
        }) as unknown as Parameters<typeof Webhooks.fromJson>[0],
      ).data as unknown as PaddleTransaction;

    it('records a completed payment Paddle lists that the ledger is missing, and counts it', async () => {
      await startAccess();
      deps.listCompletedTransactions.mockResolvedValue([
        listed('txn_september', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
        listed('txn_october', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
      ]);
      await memory.store.recordPayment({
        transactionId: 'txn_september',
        customerId: 'ctm_1',
        subscriptionId: 'sub_1',
        origin: 'web',
        priceId: 'pri_01month',
        billingInterval: 'month',
        billingFrequency: 1,
        periodStartsAt: '2026-09-01T00:00:00Z',
        periodEndsAt: '2026-10-01T00:00:00Z',
        subtotal: 3900,
        discount: 0,
        total: 3900,
        currencyCode: 'GBP',
        occurredAt: '2026-09-01T00:05:00Z',
      });

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ paymentsRecovered: 1 });

      expect(deps.listCompletedTransactions).toHaveBeenCalledWith(['sub_1'], expect.any(Date));
      expect([...memory.state.payments.keys()].sort()).toEqual(['txn_october', 'txn_september']);
      // The recovered month is in the run the reconcile stores.
      expect(memory.state.entitlementStates.get('ctm_1')?.run).toMatchObject({
        startedAt: new Date('2026-09-01T00:00:00Z'),
        paidThrough: new Date('2026-11-01T00:00:00Z'),
      });
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Recovered 1 payment for customer ctm_1',
        expect.stringContaining('txn_october'),
      );
    });

    it('records nothing Paddle lists for another product, and asks nothing for a customer with no Pro subscription', async () => {
      await startAccess();
      deps.listCompletedTransactions.mockResolvedValue([
        listed('txn_other', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'pro_02'),
      ]);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ paymentsRecovered: 0 });
      expect(memory.state.payments.size).toBe(0);
      expect(deps.alertOperator).not.toHaveBeenCalled();

      memory.state.subscriptions.clear();
      deps.listCompletedTransactions.mockClear();
      await reconcileCustomer('ctm_1', deps);
      expect(deps.listCompletedTransactions).not.toHaveBeenCalled();
    });

    it('records only completed transactions, each once, however Paddle lists them', async () => {
      await startAccess();
      const october = listed('txn_october', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
      deps.listCompletedTransactions.mockResolvedValue([
        { ...listed('txn_billed', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'), status: 'billed' },
        { ...listed('txn_past_due', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z'), status: 'past_due' },
        october,
        october,
      ]);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ paymentsRecovered: 1 });
      expect([...memory.state.payments.keys()]).toEqual(['txn_october']);
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Recovered 1 payment for customer ctm_1',
        expect.not.stringContaining('txn_billed'),
      );
    });

    it('carries on without Paddle: grace still ends, and the operator is alerted once, not for every customer', async () => {
      await startAccess();
      await record({ status: 'past_due', graceStartedAt: new Date('2026-10-01T00:00:00Z') });
      await syncCustomer('ctm_1', deps);
      memory.state.emails.set('ctm_2', 'second@example.com');
      memory.subscribe('ctm_2', { subscriptionId: 'sub_2' });
      vi.clearAllMocks();
      deps.listCompletedTransactions.mockRejectedValue(new Error('Paddle unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({
        access: 'ended',
        paymentsRecovered: null,
      });
      await expect(reconcileCustomer('ctm_2', deps)).resolves.toMatchObject({ paymentsRecovered: null });

      expect(memory.state.access.get('ctm_1')?.status).toBe('lapsed');
      expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Reconcile cannot list payments from Paddle',
        expect.stringContaining('Paddle unavailable'),
      );
    });

    it('alerts again about Paddle once a few hours have passed', async () => {
      await startAccess();
      deps.listCompletedTransactions.mockRejectedValue(new Error('Paddle unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await reconcileCustomer('ctm_1', deps);
      vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
      await reconcileCustomer('ctm_1', deps);
      vi.setSystemTime(new Date('2026-10-01T07:00:00Z'));
      await reconcileCustomer('ctm_1', deps);

      expect(deps.alertOperator).toHaveBeenCalledTimes(2);
    });
  });

  describe('org invitations', () => {
    it('records an invitation GitHub sent when access started, and leaves it pending until accepted', async () => {
      await startAccess('pending');
      expect(memory.state.access.get('ctm_1')).toMatchObject({
        githubState: 'invited',
        githubInvitedAt: new Date('2026-10-01T00:10:00Z'),
      });

      deps.github.membershipOf.mockResolvedValue('pending');
      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'unchanged' });

      expect(deps.github.grantAccess).not.toHaveBeenCalled();
      expect(githubState()).toBe('invited');
    });

    it('records the customer as a member once they accept', async () => {
      await startAccess('pending');
      deps.github.membershipOf.mockResolvedValue('active');

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'accepted' });

      expect(memory.state.access.get('ctm_1')).toMatchObject({ githubState: 'active', githubInvitedAt: null });
      expect(deps.github.grantAccess).not.toHaveBeenCalled();
    });

    it('sends a new invitation once GitHub has dropped the unaccepted one', async () => {
      await startAccess('pending');
      vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
      deps.github.membershipOf.mockResolvedValue(null); // GitHub drops an invitation after 7 days
      deps.github.grantAccess.mockResolvedValue('pending');

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'invited' });

      expect(deps.github.grantAccess).toHaveBeenCalledExactlyOnceWith('octocat');
      expect(memory.state.access.get('ctm_1')).toMatchObject({
        githubState: 'invited',
        githubInvitedAt: new Date('2026-10-09T04:00:00Z'),
      });
    });

    it('invites an entitled customer again after they left or were removed from the team', async () => {
      await startAccess('active');
      deps.github.membershipOf.mockResolvedValue(null);
      deps.github.grantAccess.mockResolvedValue('pending');

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'invited' });
      expect(githubState()).toBe('invited');
    });

    it('cancels the pending invitation of a customer who is no longer entitled', async () => {
      deps.config = testServerConfig({ provisioning: 'manual' });
      await record({ status: 'canceled' });
      await syncCustomer('ctm_1', deps);
      deps.github.membershipOf.mockResolvedValue('pending');

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'removed' });
      expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    });

    it('cancels an invitation left pending by a removal that failed after leaving the team', async () => {
      await record({ status: 'canceled' });
      await syncCustomer('ctm_1', deps);
      deps.github.membershipOf.mockResolvedValue(null);
      deps.github.hasPendingInvitation.mockResolvedValue(true);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'removed' });
      expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    });

    it('removes a lapsed customer whose GitHub account was renamed, under its new login', async () => {
      await record({ status: 'canceled' });
      await syncCustomer('ctm_1', deps);
      memory.state.githubUsers.set(1, 'octocat-renamed');
      deps.github.membershipOf.mockImplementation(async (login: string) =>
        login === 'octocat-renamed' ? 'active' : null,
      );

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'removed' });
      expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat-renamed');
    });

    it('does nothing for a lapsed customer with neither a membership nor an invitation', async () => {
      await record({ status: 'canceled' });
      await syncCustomer('ctm_1', deps);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'unchanged' });
      expect(deps.github.hasPendingInvitation).toHaveBeenCalledWith('octocat');
      expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    });
  });

  it('grants access to a customer who linked GitHub after their access started, only in automated mode', async () => {
    memory.state.githubAccounts.clear();
    await startAccess();
    memory.linkGithub('ctm_1', 'octocat');

    deps.config = testServerConfig({ provisioning: 'manual' });
    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'withheld' });
    expect(deps.github.grantAccess).not.toHaveBeenCalled();

    deps.config = testServerConfig({ provisioning: 'auto' });
    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'granted' });
    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(githubState()).toBe('active');
  });

  it('removes a customer who is not entitled from the team but leaves their licence, whatever the mode', async () => {
    deps.config = testServerConfig({ provisioning: 'manual' });
    await record({ status: 'canceled' });
    await syncCustomer('ctm_1', deps);
    await memory.store.recordLicence({ customerId: 'ctm_1', jwt: 'left-over' });
    deps.github.membershipOf.mockResolvedValue('active');

    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'removed' });
    expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.licences('ctm_1')).toEqual([{ customerId: 'ctm_1', jwt: 'left-over' }]);
  });

  it('restores access recorded as ended while a subscription still entitles the customer', async () => {
    await record();
    memory.state.access.set('ctm_1', { status: 'lapsed', githubState: 'none', githubInvitedAt: null });

    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ access: 'started', licence: 'issued' });
    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_1')?.status).toBe('active');
  });

  it('retries a grant that failed, and throws while it keeps failing so the worker retries the job', async () => {
    deps.github.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));
    await record();
    await syncCustomer('ctm_1', deps);
    expect(githubState()).toBe('failed');

    deps.github.grantAccess.mockRejectedValueOnce(new Error('GitHub unavailable'));
    await expect(reconcileCustomer('ctm_1', deps)).rejects.toThrow('GitHub grant failed');

    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ github: 'granted' });
    expect(githubState()).toBe('active');
  });
});
