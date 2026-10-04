import { Webhooks } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaddleEventJson } from '@/server/db/customer-jobs';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { adjustmentEvent, customerEvent, subscriptionEvent, transactionEvent } from '@/test/paddle-events';
import { memory } from '@/test/memory-billing-store';
import { syncCustomer } from './customer-access';
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

const WELCOME = 'Welcome to Tenantry Pro: create a feed token to install it';
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
  });

  it('keeps a cancelled subscription revoked when an older update is delivered after the cancellation', async () => {
    await applyPaddleEvent(delivered(created), deps);
    await applyPaddleEvent(delivered(cancelled), deps);

    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
    vi.clearAllMocks();

    await applyPaddleEvent(delivered(earlierUpdate), deps);

    expect(memory.state.subscriptions.get('sub_01')?.status).toBe('canceled');
    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
    expect(memory.licences('ctm_01')).toHaveLength(1); // kept: the key does not end with the subscription
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
    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
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

    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
    expect(memory.licences('ctm_01')).toHaveLength(1); // kept: the key does not end with the subscription
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

    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
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

    expect(memory.state.subscriptions.get('sub_01')?.productId).toBe('pro_02');
    expect(memory.state.access.get('ctm_01')).toBe('active');
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

  it('applies the same events in order: access granted, then ended', async () => {
    await applyPaddleEvent(delivered(earlierUpdate), deps);
    expect(memory.state.access.get('ctm_01')).toBe('active');
    expect(memory.licences('ctm_01')).toHaveLength(1);

    await applyPaddleEvent(delivered(cancelled), deps);
    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
    expect(memory.licences('ctm_01')).toHaveLength(1); // kept: the key does not end with the subscription
    expect(emailSubjects()).toEqual([WELCOME, ENDED]);
  });

  it('keeps access for a customer with two subscriptions, with a licence, when one is cancelled', async () => {
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
    expect(emailSubjects()).toEqual([WELCOME]);
    vi.clearAllMocks();

    await applyPaddleEvent(delivered(cancelled), deps);

    expect(memory.state.subscriptions.get('sub_01')?.status).toBe('canceled');
    expect(memory.state.access.get('ctm_01')).toBe('active');
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(memory.licences('ctm_01')).toHaveLength(1);

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

    expect(memory.state.access.get('ctm_01')).toBe('lapsed');
    expect(memory.licences('ctm_01')).toHaveLength(1); // kept: the key does not end with the subscription
    expect(emailSubjects()).toEqual([ENDED]);
  });

  it('fails a subscription event whose customer is not recorded yet, so the worker retries it', async () => {
    memory.state.emails.delete('ctm_01');

    await expect(applyPaddleEvent(delivered(earlierUpdate), deps)).rejects.toMatchObject({ code: '23503' });
    expect(memory.state.subscriptions.size).toBe(0);
    expect(deps.sendEmail).not.toHaveBeenCalled();
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

      expect(memory.state.subscriptions.get('sub_01')).toMatchObject({
        status: 'past_due',
        graceStartedAt: '2026-10-01T00:05:00Z',
      });
      expect(memory.state.access.get('ctm_01')).toBe('grace');
      expect(memory.licences('ctm_01')).toHaveLength(1);

      vi.setSystemTime(new Date('2026-10-08T00:10:00Z'));
      await applyPaddleEvent(delivered(retryFailed), deps);
      expect(memory.state.subscriptions.get('sub_01')?.graceStartedAt).toBe('2026-10-01T00:05:00Z');

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
      expect(memory.state.subscriptions.get('sub_01')).toMatchObject({ status: 'active', graceStartedAt: null });
      expect(memory.state.access.get('ctm_01')).toBe('active');
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

      expect(memory.state.access.get('ctm_01')).toBe('lapsed');
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

  describe('payments and perpetual entitlement', () => {
    // Monthly renewals of sub_01 from January 2027, each delivered when its period starts.
    const renewal = (month: number, extra: Partial<Parameters<typeof transactionEvent>[0]> = {}) => {
      const startsAt = new Date(Date.UTC(2027, month, 1)).toISOString();
      const endsAt = new Date(Date.UTC(2027, month + 1, 1)).toISOString();
      return transactionEvent({
        eventId: `evt_txn_${month}`,
        transactionId: `txn_${month}`,
        occurredAt: startsAt,
        origin: month === 0 ? 'web' : 'subscription_recurring',
        period: { startsAt, endsAt },
        ...extra,
      });
    };
    const year = Array.from({ length: 12 }, (_, month) => renewal(month));

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('records each completed Pro payment with its period, amounts and origin', async () => {
      vi.setSystemTime(new Date('2027-01-01T00:10:00Z'));

      await applyPaddleEvent(delivered(year[0]), deps);

      expect(memory.state.payments.get('txn_0')).toEqual({
        transactionId: 'txn_0',
        customerId: 'ctm_01',
        subscriptionId: 'sub_01',
        origin: 'web',
        priceId: 'pri_01month',
        billingInterval: 'month',
        billingFrequency: 1,
        periodStartsAt: '2027-01-01T00:00:00.000Z',
        periodEndsAt: '2027-02-01T00:00:00.000Z',
        subtotal: 3900,
        discount: 0,
        total: 3900,
        tax: 0,
        currencyCode: 'GBP',
        occurredAt: '2027-01-01T00:00:00.000Z',
        status: 'paid',
      });
      // No access recorded yet (the subscription event follows), so no current run is shown, but the payment counts.
      expect(memory.state.entitlementStates.get('ctm_01')).toMatchObject({ run: null, vestedThrough: null });
    });

    it('vests after 12 paid months, as the reconcile after the 12th month finds, however the events were delivered', async () => {
      vi.setSystemTime(new Date('2027-01-01T00:10:00Z'));
      await applyPaddleEvent(delivered(created), deps);
      // Delivered in reverse, each twice: the ledger is the same.
      for (const event of [...year].reverse()) {
        await applyPaddleEvent(delivered(event), deps);
        await applyPaddleEvent(delivered(event), deps);
      }

      vi.setSystemTime(new Date('2027-12-31T23:00:00Z'));
      await syncCustomer('ctm_01', deps);
      expect(memory.state.entitlementStates.get('ctm_01')).toMatchObject({
        vestedThrough: null,
        run: { startedAt: new Date('2027-01-01T00:00:00Z'), monthsPaid: 12 },
      });

      vi.setSystemTime(new Date('2028-01-01T04:00:00Z'));
      await syncCustomer('ctm_01', deps);
      expect(memory.state.entitlementStates.get('ctm_01')?.vestedThrough).toEqual(new Date('2028-01-01T00:00:00Z'));
      expect(memory.state.payments.size).toBe(12);
    });

    it('ignores a transaction with no billing period, no subscription or another product', async () => {
      for (const event of [
        transactionEvent({ eventId: 'evt_once', period: null }),
        transactionEvent({ eventId: 'evt_nosub', subscriptionId: null }),
        transactionEvent({ eventId: 'evt_other', productId: 'pro_02' }),
      ]) {
        await applyPaddleEvent(delivered(event), deps);
      }

      expect(memory.state.payments.size).toBe(0);
      expect(memory.state.entitlementStates.size).toBe(0);
    });

    it('fails a payment whose customer is not recorded yet, so the worker retries it', async () => {
      memory.state.emails.clear();

      await expect(applyPaddleEvent(delivered(year[0]), deps)).rejects.toMatchObject({ code: '23503' });
    });

    it('records an annual payment as a conditional grant to the end of its term', async () => {
      vi.setSystemTime(new Date('2027-03-01T00:10:00Z'));

      await applyPaddleEvent(
        delivered(
          transactionEvent({
            eventId: 'evt_annual',
            transactionId: 'txn_annual',
            interval: 'year',
            origin: 'web',
            period: { startsAt: '2027-03-01T00:00:00Z', endsAt: '2028-03-01T00:00:00Z' },
          }),
        ),
        deps,
      );

      expect(memory.state.entitlementStates.get('ctm_01')).toMatchObject({
        conditionalThrough: new Date('2028-03-01T00:00:00Z'),
        vestedThrough: null,
      });
    });

    it('records refunds and chargebacks and recomputes: a refunded month no longer counts', async () => {
      vi.setSystemTime(new Date('2027-01-01T00:10:00Z'));
      for (const event of year) await applyPaddleEvent(delivered(event), deps);

      // A full refund of March, created pending and approved later; delivered approved first.
      const approved = adjustmentEvent({
        eventId: 'evt_refund_approved',
        action: 'refund',
        status: 'approved',
        transactionId: 'txn_2',
        createdAt: '2027-03-05T00:00:00Z',
        occurredAt: '2027-03-08T00:00:00Z',
      });
      const pending = adjustmentEvent({
        eventId: 'evt_refund_pending',
        eventType: 'adjustment.created',
        action: 'refund',
        status: 'pending_approval',
        transactionId: 'txn_2',
        occurredAt: '2027-03-05T00:00:00Z',
      });
      // Both events describe one adjustment.
      (pending.data as { id: string }).id = (approved.data as { id: string }).id;
      vi.setSystemTime(new Date('2027-03-10T00:00:00Z'));
      await applyPaddleEvent(delivered(approved), deps);
      await applyPaddleEvent(delivered(pending), deps);

      const [adjustment] = memory.state.adjustments.values();
      expect(adjustment).toMatchObject({
        status: 'approved',
        approvedAt: '2027-03-08T00:00:00Z',
        amount: 3900,
        currencyCode: 'GBP',
      });
      expect(memory.state.payments.get('txn_2')?.status).toBe('refunded');

      vi.setSystemTime(new Date('2028-01-02T00:00:00Z'));
      await syncCustomer('ctm_01', deps);
      expect(memory.state.entitlementStates.get('ctm_01')?.vestedThrough).toBeNull();
    });

    it('records the time a cancelled subscription ended, which ends its last period', async () => {
      vi.setSystemTime(new Date('2027-01-01T00:10:00Z'));
      await applyPaddleEvent(delivered(created), deps);
      await applyPaddleEvent(delivered(year[0]), deps);

      await applyPaddleEvent(
        delivered(
          subscriptionEvent({
            eventId: 'evt_cancelled_2027',
            eventType: 'subscription.canceled',
            occurredAt: '2027-01-10T00:00:00Z',
            status: 'canceled',
          }),
        ),
        deps,
      );

      expect(memory.state.subscriptions.get('sub_01')?.endedAt).toBe('2027-01-10T00:00:00Z');
      expect(memory.state.entitlementStates.get('ctm_01')?.run).toBeNull();
    });
  });

  describe('amounts', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2027-01-20T00:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('records what a payment charged and an adjustment returned, so half refunded counts as half a month', async () => {
      await applyPaddleEvent(delivered(created), deps);
      await applyPaddleEvent(
        delivered(
          transactionEvent({
            eventId: 'evt_january',
            transactionId: 'txn_january',
            occurredAt: '2027-01-01T00:00:00Z',
            total: '4680',
            tax: '780',
            period: { startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-01-31T00:00:00Z' },
          }),
        ),
        deps,
      );
      await applyPaddleEvent(
        delivered(
          adjustmentEvent({
            eventId: 'evt_half',
            action: 'refund',
            type: 'partial',
            status: 'approved',
            transactionId: 'txn_january',
            subtotal: '1950',
            occurredAt: '2027-01-10T00:00:00Z',
          }),
        ),
        deps,
      );

      expect(memory.state.payments.get('txn_january')).toMatchObject({ total: 4680, tax: 780 });
      expect([...memory.state.adjustments.values()][0]).toMatchObject({ amount: 1950 });
      // 3900 charged before tax, 1950 returned: the first half of the 30-day period.
      expect(memory.state.entitlementStates.get('ctm_01')?.run).toMatchObject({
        paidThrough: new Date('2027-01-16T00:00:00Z'),
      });
      expect(memory.state.payments.get('txn_january')?.status).toBe('partially_refunded');
    });
  });
});
