import { Webhooks } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaddleEventJson } from '@/utils/webhooks/inbox';
import { adjustmentEvent, customerEvent, subscriptionEvent } from '@/utils/testing/paddle-events';
import { memory } from '@/utils/testing/memory-entitlements';
import { ProcessWebhook } from './process-webhook';

const state = vi.hoisted(() => ({
  lastEventAt: new Map<string, string>(),
  customerEmails: new Map<string, string>(),
  rpcError: null as { code: string; message: string } | null,
  scheduledChanges: new Map<string, { at: string | null; action: string | null }>(),
}));

// Stands in for record_subscription_event and record_customer_event (supabase/tests/database): each applies
// an event unless a newer one for the same subscription or customer was applied already.
vi.mock('@/utils/supabase/server-internal', () => ({
  createClient: () => ({
    rpc: async (name: string, args: Record<string, string>) => {
      if (state.rpcError) return { data: null, error: state.rpcError };
      const key = name === 'record_customer_event' ? `customer:${args.p_customer_id}` : args.p_subscription_id;
      const last = state.lastEventAt.get(key);
      if (last && new Date(last) > new Date(args.p_occurred_at)) return { data: false, error: null };
      state.lastEventAt.set(key, args.p_occurred_at);
      if (name === 'record_customer_event') state.customerEmails.set(args.p_customer_id, args.p_email);
      else
        state.scheduledChanges.set(args.p_subscription_id, {
          at: args.p_scheduled_change,
          action: args.p_scheduled_change_action,
        });
      return { data: true, error: null };
    },
  }),
}));

const effects = vi.hoisted(() => ({
  grantAccess: vi.fn().mockResolvedValue('active'),
  revokeAccess: vi.fn(),
  sendEmail: vi.fn(),
  cancelSubscriptionNow: vi.fn(),
  alertOperator: vi.fn(),
}));
vi.mock('@/utils/paddle/cancel-subscription', () => ({ cancelSubscriptionNow: effects.cancelSubscriptionNow }));
vi.mock('@/utils/email/alerts', () => ({ alertOperator: effects.alertOperator }));
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
vi.mock('@/utils/licensing/licence-issuer', () => ({
  issueLicence: ({ customerId }: { customerId: string }) => `licence:${customerId}`,
}));
vi.mock('@/utils/provisioning-guard', () => ({ automatedProvisioningEnabled: () => true }));

function delivered(event: PaddleEventJson) {
  return Webhooks.fromJson(event as unknown as Parameters<typeof Webhooks.fromJson>[0]);
}

function emailSubjects(): string[] {
  return effects.sendEmail.mock.calls.map(([message]) => message.subject);
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

describe('ProcessWebhook', () => {
  const processor = new ProcessWebhook();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PADDLE_PRO_PRODUCT_ID', 'pro_01');
    state.lastEventAt.clear();
    state.scheduledChanges.clear();
    state.customerEmails.clear();
    state.rpcError = null;
    memory.reset();
    memory.state.emails.set('ctm_01', 'buyer@example.com');
    memory.linkGithub('ctm_01', 'octocat');
  });

  it('keeps a cancelled subscription revoked when an older update is delivered after the cancellation', async () => {
    await processor.processEvent(delivered(created));
    await processor.processEvent(delivered(cancelled));

    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    vi.clearAllMocks();

    await processor.processEvent(delivered(earlierUpdate));

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records a subscription to another product but entitles its customer to nothing', async () => {
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_other',
          occurredAt: '2026-09-28T11:00:00Z',
          status: 'active',
          productId: 'pro_02',
        }),
      ),
    );

    expect(state.lastEventAt.get('sub_01')).toBeDefined();
    expect(memory.state.entitlements.size).toBe(0);
    expect(memory.state.access.size).toBe(0);
    expect(effects.grantAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('ends access when the Pro subscription moves to another product, and on later events for it', async () => {
    await processor.processEvent(delivered(created));
    vi.clearAllMocks();

    const movedAway = subscriptionEvent({
      eventId: 'evt_moved',
      occurredAt: '2026-09-28T11:30:00Z',
      status: 'active',
      productId: 'pro_02',
    });
    await processor.processEvent(delivered(movedAway));

    expect(memory.state.entitlements.get('sub_01')).toMatchObject({ status: 'revoked', graceStartedAt: null });
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([ENDED]);
    vi.clearAllMocks();

    // A later event for the other product changes nothing more.
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_moved_cancel',
          eventType: 'subscription.canceled',
          occurredAt: '2026-09-28T12:00:00Z',
          status: 'canceled',
          productId: 'pro_02',
        }),
      ),
    );

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps access through another Pro subscription when one moves to another product', async () => {
    await processor.processEvent(delivered(created));
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_created_2',
          eventType: 'subscription.created',
          occurredAt: '2026-09-28T11:10:00Z',
          status: 'active',
          subscriptionId: 'sub_02',
        }),
      ),
    );
    vi.clearAllMocks();

    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_moved',
          occurredAt: '2026-09-28T11:30:00Z',
          status: 'active',
          productId: 'pro_02',
        }),
      ),
    );

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')?.status).toBe('active');
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
  });

  describe('customer events', () => {
    const emailEvent = (eventId: string, occurredAt: string, email: string) =>
      delivered(customerEvent({ eventId, eventType: 'customer.updated', occurredAt, customerId: 'ctm_01', email }));

    it('records the email normalised, with when the event occurred', async () => {
      await processor.processEvent(emailEvent('evt_c1', '2026-09-29T10:00:00Z', ' Buyer@Example.COM '));

      expect(state.customerEmails.get('ctm_01')).toBe('buyer@example.com');
      expect(state.lastEventAt.get('customer:ctm_01')).toBe('2026-09-29T10:00:00Z');
    });

    it('keeps a newer email when an older customer event is delivered after it', async () => {
      await processor.processEvent(emailEvent('evt_c1', '2026-09-29T10:00:00Z', 'old@example.com'));
      await processor.processEvent(emailEvent('evt_c3', '2026-09-29T11:00:00Z', 'new@example.com'));
      await processor.processEvent(emailEvent('evt_c2', '2026-09-29T10:30:00Z', 'old@example.com'));

      expect(state.customerEmails.get('ctm_01')).toBe('new@example.com');
    });

    it('fails when the customer cannot be recorded, so the worker retries it', async () => {
      state.rpcError = { code: '08006', message: 'connection failure' };

      await expect(
        processor.processEvent(emailEvent('evt_c1', '2026-09-29T10:00:00Z', 'a@example.com')),
      ).rejects.toEqual(state.rpcError);
    });
  });

  it('changes nothing when the same event is processed again, as after a worker crash before it was marked done', async () => {
    await processor.processEvent(delivered(created));
    await processor.processEvent(delivered(created));
    await processor.processEvent(delivered(cancelled));
    await processor.processEvent(delivered(cancelled));

    expect(effects.grantAccess).toHaveBeenCalledOnce();
    expect(effects.revokeAccess).toHaveBeenCalledOnce();
    expect(memory.state.licences).toHaveLength(1);
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
  });

  it('records a scheduled cancellation with when it takes effect, for the billing card', async () => {
    await processor.processEvent(delivered(created));
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_cancel_scheduled',
          occurredAt: '2026-09-28T11:15:00Z',
          status: 'active',
          cancelsAt: '2026-10-01T00:00:00Z',
        }),
      ),
    );

    expect(state.scheduledChanges.get('sub_01')).toEqual({ at: '2026-10-01T00:00:00Z', action: 'cancel' });
  });

  it('applies the same events in order: access granted, then revoked', async () => {
    await processor.processEvent(delivered(earlierUpdate));
    expect(effects.grantAccess).toHaveBeenCalledWith('octocat');
    expect(memory.liveLicences('ctm_01')).toHaveLength(1);

    await processor.processEvent(delivered(cancelled));
    expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
  });

  it('keeps a customer with two subscriptions in the team, with a licence, when one is cancelled', async () => {
    const second = { subscriptionId: 'sub_02', periodEndsAt: '2026-10-15T00:00:00Z' };
    await processor.processEvent(delivered(created));
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_created_2',
          eventType: 'subscription.created',
          occurredAt: '2026-09-28T11:10:00Z',
          status: 'active',
          ...second,
        }),
      ),
    );

    // Access started once, with the first subscription.
    expect(effects.grantAccess).toHaveBeenCalledOnce();
    expect(emailSubjects()).toEqual([WELCOME]);
    vi.clearAllMocks();

    await processor.processEvent(delivered(cancelled));

    expect(memory.state.entitlements.get('sub_01')?.status).toBe('revoked');
    expect(memory.state.access.get('ctm_01')).toEqual({
      status: 'active',
      githubState: 'active',
      githubInvitedAt: null,
    });
    expect(effects.revokeAccess).not.toHaveBeenCalled();
    expect(effects.sendEmail).not.toHaveBeenCalled();
    expect(memory.liveLicences('ctm_01')).toHaveLength(1);

    // Access ends with the last subscription.
    await processor.processEvent(
      delivered(
        subscriptionEvent({
          eventId: 'evt_cancel_2',
          eventType: 'subscription.canceled',
          occurredAt: '2026-09-28T12:10:00Z',
          status: 'canceled',
          ...second,
        }),
      ),
    );

    expect(effects.revokeAccess).toHaveBeenCalledExactlyOnceWith('octocat');
    expect(memory.state.access.get('ctm_01')).toEqual({
      status: 'revoked',
      githubState: 'none',
      githubInvitedAt: null,
    });
    expect(memory.liveLicences('ctm_01')).toEqual([]);
    expect(emailSubjects()).toEqual([ENDED]);
  });

  it('fails a subscription event whose customer is not recorded yet, so the worker retries it', async () => {
    state.rpcError = {
      code: '23503',
      message: 'violates foreign key constraint "public_subscriptions_customer_id_fkey"',
    };

    await expect(processor.processEvent(delivered(earlierUpdate))).rejects.toMatchObject({ code: '23503' });
    expect(memory.state.entitlements.size).toBe(0);
    expect(effects.grantAccess).not.toHaveBeenCalled();
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
      await processor.processEvent(delivered(created));
      await processor.processEvent(delivered(renewalFailed));

      expect(memory.state.entitlements.get('sub_01')).toMatchObject({
        status: 'grace',
        graceStartedAt: new Date('2026-10-01T00:05:00Z'),
      });
      expect(memory.liveLicences('ctm_01')).toHaveLength(1);

      vi.setSystemTime(new Date('2026-10-08T00:10:00Z'));
      await processor.processEvent(delivered(retryFailed));
      expect(memory.state.entitlements.get('sub_01')?.graceStartedAt).toEqual(new Date('2026-10-01T00:05:00Z'));

      await processor.processEvent(
        delivered(
          subscriptionEvent({
            eventId: 'evt_recovered',
            occurredAt: '2026-10-08T12:00:00Z',
            status: 'active',
            periodEndsAt: '2026-11-01T00:00:00Z',
          }),
        ),
      );
      expect(memory.state.entitlements.get('sub_01')).toMatchObject({ status: 'active', graceStartedAt: null });
      expect(memory.state.access.get('ctm_01')?.status).toBe('active');
      expect(effects.revokeAccess).not.toHaveBeenCalled();
    });

    it('does not restore access for a past-due event processed after grace has ended', async () => {
      await processor.processEvent(delivered(created));
      await processor.processEvent(delivered(renewalFailed));

      vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
      await processor.processEvent(
        delivered(
          subscriptionEvent({
            eventId: 'evt_past_due_late',
            occurredAt: '2026-11-01T00:05:00Z',
            status: 'past_due',
            periodEndsAt: '2026-11-01T00:00:00Z',
          }),
        ),
      );

      expect(memory.state.access.get('ctm_01')?.status).toBe('revoked');
      expect(effects.revokeAccess).toHaveBeenCalledWith('octocat');
    });
  });

  describe('refunds and chargebacks', () => {
    beforeEach(() => {
      effects.cancelSubscriptionNow.mockResolvedValue(true);
    });

    const adjusted = (options: Parameters<typeof adjustmentEvent>[0]) =>
      processor.processEvent(delivered(adjustmentEvent(options)));

    it('cancels the subscription at once when a full refund is approved, and tells the operator', async () => {
      await adjusted({ eventId: 'evt_refund', action: 'refund', status: 'approved' });

      expect(effects.cancelSubscriptionNow).toHaveBeenCalledExactlyOnceWith('sub_01');
      expect(effects.alertOperator).toHaveBeenCalledWith(
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

      expect(effects.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(effects.alertOperator).not.toHaveBeenCalled();
    });

    it('cancels on an approved chargeback, but only alerts on a chargeback warning', async () => {
      await adjusted({ eventId: 'evt_warning', action: 'chargeback_warning', status: 'approved' });
      expect(effects.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(effects.alertOperator).toHaveBeenCalledWith(
        'Paddle chargeback warning for customer ctm_01',
        expect.any(String),
      );

      await adjusted({ eventId: 'evt_chargeback', action: 'chargeback', status: 'approved' });
      expect(effects.cancelSubscriptionNow).toHaveBeenCalledExactlyOnceWith('sub_01');
    });

    it('leaves access alone on a partial refund, telling the operator', async () => {
      await adjusted({ eventId: 'evt_partial', action: 'refund', type: 'partial', status: 'approved' });

      expect(effects.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(effects.alertOperator).toHaveBeenCalledWith(
        'Paddle refund for customer ctm_01',
        expect.stringContaining('Access is unchanged'),
      );
    });

    it('ignores credits and reversals', async () => {
      await adjusted({ eventId: 'evt_credit', action: 'credit', status: 'approved' });
      await adjusted({ eventId: 'evt_reverse', action: 'chargeback_reverse', status: 'approved' });

      expect(effects.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(effects.alertOperator).not.toHaveBeenCalled();
    });

    it('tells the operator about a refund with no subscription, changing nothing', async () => {
      await adjusted({ eventId: 'evt_orphan', action: 'refund', status: 'approved', subscriptionId: null });

      expect(effects.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(effects.alertOperator).toHaveBeenCalledWith(
        'Paddle refund without a subscription for customer ctm_01',
        expect.any(String),
      );
    });

    it('does nothing more for a subscription already cancelled (a repeated or second refund)', async () => {
      effects.cancelSubscriptionNow.mockResolvedValue(false);

      await adjusted({ eventId: 'evt_again', action: 'refund', status: 'approved' });
      expect(effects.alertOperator).not.toHaveBeenCalled();
    });

    it('fails the event when Paddle cannot be reached, so the worker retries it', async () => {
      effects.cancelSubscriptionNow.mockRejectedValue(new Error('Paddle unavailable'));

      await expect(adjusted({ eventId: 'evt_down', action: 'refund', status: 'approved' })).rejects.toThrow(
        'Paddle unavailable',
      );
    });
  });
});
