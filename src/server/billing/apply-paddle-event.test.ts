import { Webhooks } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaddleEventJson } from '@/server/db/customer-jobs';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { adjustmentEvent, customerEvent, subscriptionEvent } from '@/test/paddle-events';
import { memory } from '@/test/memory-billing-store';
import { applyPaddleEvent } from './apply-paddle-event';

// The in-memory store applies a subscription or customer event unless a newer one was applied already, as the
// database functions do (supabase/tests/database); billing-store.test.ts checks the arguments the real store passes
// them.
let deps: FakeBillingDeps;

function delivered(event: PaddleEventJson) {
  return Webhooks.fromJson(event as unknown as Parameters<typeof Webhooks.fromJson>[0]);
}

function emailSubjects(): string[] {
  return deps.sendEmail.mock.calls.map(([message]) => message.subject);
}

const WELCOME = 'Welcome to Tenantry Pro — connect GitHub to get access';
const ENDED = 'Your Tenantry Pro subscription has ended';

const created = subscriptionEvent({
  eventId: 'evt_created',
  eventType: 'subscription.created',
  occurredAt: '2026-09-28T11:00:00Z',
  status: 'active',
});
const earlierUpdate = subscriptionEvent({
  eventId: 'evt_update',
  occurredAt: '2026-09-28T11:30:00Z',
  status: 'active',
});
const cancelled = subscriptionEvent({
  eventId: 'evt_cancel',
  eventType: 'subscription.canceled',
  occurredAt: '2026-09-28T12:00:00Z',
  status: 'canceled',
});

describe('applyPaddleEvent', () => {
  beforeEach(() => {
    deps = fakeBillingDeps();
    memory.reset();
    memory.state.emails.set('ctm_01', 'buyer@example.com');
    memory.linkGithub('ctm_01', 'octocat');
  });

  it('keeps a cancelled subscription revoked when an older update is delivered after the cancellation', async () => {
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(delivered(cancelled), deps);

    expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    vi.clearAllMocks();

    await applyPaddleEvent(delivered(earlierUpdate), deps);

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('records a subscription to another product but entitles its customer to nothing', async () => {
    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_other',
          occurredAt: '2026-09-28T11:00:00Z',
          status: 'active',
          productId: 'pro_02',
        }),
      ),
      deps,
    );

    expect(memory.state.subscriptions.get('sub_01')).toBeDefined();
    expect(memory.state.entitlements.size).toBe(0);
    expect(memory.state.access.size).toBe(0);
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('ends access when the Pro subscription moves to another product, and on later events for it', async () => {
    await applyPaddleEvent(delivered(created), deps);
    vi.clearAllMocks();

    const movedAway = subscriptionEvent({
      eventId: 'evt_moved',
      occurredAt: '2026-09-28T11:30:00Z',
      status: 'active',
      productId: 'pro_02',
    });
    await applyPaddleEvent(delivered(movedAway), deps);

    expect(memory.state.entitlements.get('sub_01')).toMatchObject({ status: 'revoked', graceStartedAt: null });
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([ENDED]);
    vi.clearAllMocks();

    // A later event for the other product changes nothing more.
    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_moved_cancel',
          eventType: 'subscription.canceled',
          occurredAt: '2026-09-28T12:00:00Z',
          status: 'canceled',
          productId: 'pro_02',
        }),
      ),
      deps,
    );

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps access through another Pro subscription when one moves to another product', async () => {
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_created_2',
          eventType: 'subscription.created',
          occurredAt: '2026-09-28T11:10:00Z',
          status: 'active',
          subscriptionId: 'sub_02',
        }),
      ),
      deps,
    );
    vi.clearAllMocks();

    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_moved',
          occurredAt: '2026-09-28T11:30:00Z',
          status: 'active',
          productId: 'pro_02',
        }),
      ),
      deps,
    );

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')?.status).toBe('active');
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  describe('customer events', () => {
    const emailEvent = (eventId: string, occurredAt: string, email: string) =>
      delivered(customerEvent({ eventId, eventType: 'customer.updated', occurredAt, customerId: 'ctm_01', email }));

    it('records the email normalised, with when the event occurred', async () => {
      await applyPaddleEvent(emailEvent('evt_c1', '2026-09-29T10:00:00Z', ' Buyer@Example.COM '), deps);

      expect(memory.state.emails.get('ctm_01')).toBe('buyer@example.com');
      expect(memory.state.customerEventAt.get('ctm_01')).toBe('2026-09-29T10:00:00Z');
    });

    it('keeps a newer email when an older customer event is delivered after it', async () => {
      await applyPaddleEvent(emailEvent('evt_c1', '2026-09-29T10:00:00Z', 'old@example.com'), deps);
      await applyPaddleEvent(emailEvent('evt_c3', '2026-09-29T11:00:00Z', 'new@example.com'), deps);
      await applyPaddleEvent(emailEvent('evt_c2', '2026-09-29T10:30:00Z', 'old@example.com'), deps);

      expect(memory.state.emails.get('ctm_01')).toBe('new@example.com');
    });

    it('fails when the customer cannot be recorded, so the worker retries it', async () => {
      const connectionFailure = { code: '08006', message: 'connection failure' };
      vi.spyOn(deps.store, 'recordCustomerEvent').mockRejectedValueOnce(connectionFailure);

      await expect(
        applyPaddleEvent(emailEvent('evt_c1', '2026-09-29T10:00:00Z', 'a@example.com'), deps),
      ).rejects.toEqual(connectionFailure);
    });
  });

  it('changes nothing when the same event is processed again, as after a worker crash before it was marked done', async () => {
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(delivered(cancelled), deps);
    await applyPaddleEvent(delivered(cancelled), deps);

    expect(deps.github.grantAccess).toHaveBeenCalledOnce();
    expect(deps.github.revokeAccess).toHaveBeenCalledOnce();
    expect(memory.state.licences).toHaveLength(1);
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
  });

  it('records a scheduled cancellation with when it takes effect, for the billing card', async () => {
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_cancel_scheduled',
          occurredAt: '2026-09-28T11:15:00Z',
          status: 'active',
          cancelsAt: '2026-10-01T00:00:00Z',
        }),
      ),
      deps,
    );

    expect(memory.state.subscriptions.get('sub_01')).toMatchObject({
      scheduledChangeAt: '2026-10-01T00:00:00Z',
      scheduledChangeAction: 'cancel',
    });
  });

  it('applies the same events in order: access granted, then revoked', async () => {
    await applyPaddleEvent(delivered(earlierUpdate), deps);
    expect(deps.github.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_01')).toHaveLength(1);

    await applyPaddleEvent(delivered(cancelled), deps);
    expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
  });

  it('keeps a customer with two subscriptions in the team, with a licence, when one is cancelled', async () => {
    const second = { subscriptionId: 'sub_02', periodEndsAt: '2026-10-15T00:00:00Z' };
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_created_2',
          eventType: 'subscription.created',
          occurredAt: '2026-09-28T11:10:00Z',
          status: 'active',
          ...second,
        }),
      ),
      deps,
    );

    // Access started once, with the first subscription.
    expect(deps.github.grantAccess).toHaveBeenCalledOnce();
    expect(emailSubjects()).toEqual([WELCOME]);
    vi.clearAllMocks();

    await applyPaddleEvent(delivered(cancelled), deps);

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')).toEqual({
      status: 'active',
      githubState: 'active',
      githubInvitedAt: null,
    });
    expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(memory.liveLicences('ctm_01')).toHaveLength(1);

    // Access ends with the last subscription.
    await applyPaddleEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_cancel_2',
          eventType: 'subscription.canceled',
          occurredAt: '2026-09-28T12:10:00Z',
          status: 'canceled',
          ...second,
        }),
      ),
      deps,
    );

    expect(deps.github.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_01')).toEqual({
      status: 'revoked',
      githubState: 'none',
      githubInvitedAt: null,
    });
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([ENDED]);
  });

  it('fails a subscription event whose customer is not recorded yet, so the worker retries it', async () => {
    memory.state.emails.delete('ctm_01');

    await expect(applyPaddleEvent(delivered(earlierUpdate), deps)).rejects.toMatchObject({ code: '23503' });
    expect(memory.state.entitlements.size).toBe(0);
    expect(deps.github.grantAccess).not.toHaveBeenCalled();
  });

  describe('payment failure', () => {
    const renewalFailed = subscriptionEvent({
      eventId: 'evt_past_due',
      eventType: 'subscription.past_due',
      occurredAt: '2026-10-01T00:05:00Z',
      status: 'past_due',
      periodEndsAt: '2026-11-01T00:00:00Z',
    });
    const retryFailed = subscriptionEvent({
      eventId: 'evt_past_due_again',
      occurredAt: '2026-10-08T00:05:00Z',
      status: 'past_due',
      periodEndsAt: '2026-11-01T00:00:00Z',
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-01T00:10:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts grace at the first past-due event, keeps that start, and clears it when the payment recovers', async () => {
      await applyPaddleEvent(delivered(created), deps);
      await applyPaddleEvent(delivered(renewalFailed), deps);

      expect(memory.state.entitlements.get('sub_01')).toMatchObject({
        status: 'grace',
        graceStartedAt: new Date('2026-10-01T00:05:00Z'),
      });
      expect(memory.liveLicences('ctm_01')).toHaveLength(1);

      vi.setSystemTime(new Date('2026-10-08T00:10:00Z'));
      await applyPaddleEvent(delivered(retryFailed), deps);
      expect(memory.state.entitlements.get('sub_01')?.graceStartedAt).toEqual(new Date('2026-10-01T00:05:00Z'));

      await applyPaddleEvent(
        delivered(
          subscriptionEvent({
            eventId: 'evt_recovered',
            occurredAt: '2026-10-08T12:00:00Z',
            status: 'active',
            periodEndsAt: '2026-11-01T00:00:00Z',
          }),
        ),
        deps,
      );
      expect(memory.state.entitlements.get('sub_01')).toMatchObject({ status: 'active', graceStartedAt: null });
      expect(memory.state.access.get('ctm_01')?.status).toBe('active');
      expect(deps.github.revokeAccess).not.toHaveBeenCalled();
    });

    it('does not restore access for a past-due event processed after grace has ended', async () => {
      await applyPaddleEvent(delivered(created), deps);
      await applyPaddleEvent(delivered(renewalFailed), deps);

      vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
      await applyPaddleEvent(
        delivered(
          subscriptionEvent({
            eventId: 'evt_past_due_late',
            occurredAt: '2026-11-01T00:05:00Z',
            status: 'past_due',
            periodEndsAt: '2026-11-01T00:00:00Z',
          }),
        ),
        deps,
      );

      expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
      expect(deps.github.revokeAccess).toHaveBeenCalledWith('octocat');
    });
  });

  describe('refunds and chargebacks', () => {
    const adjusted = (options: Parameters<typeof adjustmentEvent>[0]) =>
      applyPaddleEvent(delivered(adjustmentEvent(options)), deps);

    it('cancels the subscription at once when a full refund is approved, and tells the operator', async () => {
      await adjusted({ eventId: 'evt_refund', action: 'refund', status: 'approved' });

      expect(deps.cancelSubscriptionNow).toHaveBeenCalledExactlyOnceWith('sub_01');
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Subscription sub_01 cancelled after a refund',
        expect.stringContaining('full refund'),
      );
    });

    it('waits for approval: a refund pending approval or rejected changes nothing', async () => {
      await adjusted({
        eventId: 'evt_pending',
        eventType: 'adjustment.created',
        action: 'refund',
        status: 'pending_approval',
      });
      await adjusted({ eventId: 'evt_rejected', action: 'refund', status: 'rejected' });

      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('cancels on an approved chargeback, but only alerts on a chargeback warning', async () => {
      await adjusted({ eventId: 'evt_warning', action: 'chargeback_warning', status: 'approved' });
      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Paddle chargeback warning for customer ctm_01',
        expect.any(String),
      );

      await adjusted({ eventId: 'evt_chargeback', action: 'chargeback', status: 'approved' });
      expect(deps.cancelSubscriptionNow).toHaveBeenCalledExactlyOnceWith('sub_01');
    });

    it('leaves access alone on a partial refund, telling the operator', async () => {
      await adjusted({ eventId: 'evt_partial', action: 'refund', type: 'partial', status: 'approved' });

      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Paddle refund for customer ctm_01',
        expect.stringContaining('Access is unchanged'),
      );
    });

    it('ignores credits and reversals', async () => {
      await adjusted({ eventId: 'evt_credit', action: 'credit', status: 'approved' });
      await adjusted({ eventId: 'evt_reverse', action: 'chargeback_reverse', status: 'approved' });

      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('tells the operator about a refund with no subscription, changing nothing', async () => {
      await adjusted({ eventId: 'evt_orphan', action: 'refund', status: 'approved', subscriptionId: null });

      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Paddle refund without a subscription for customer ctm_01',
        expect.any(String),
      );
    });

    it('does nothing more for a subscription already cancelled (a repeated or second refund)', async () => {
      deps.cancelSubscriptionNow.mockResolvedValue(false);

      await adjusted({ eventId: 'evt_again', action: 'refund', status: 'approved' });
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('fails the event when Paddle cannot be reached, so the worker retries it', async () => {
      deps.cancelSubscriptionNow.mockRejectedValue(new Error('Paddle unavailable'));

      await expect(adjusted({ eventId: 'evt_down', action: 'refund', status: 'approved' })).rejects.toThrow(
        'Paddle unavailable',
      );
    });
  });
});
