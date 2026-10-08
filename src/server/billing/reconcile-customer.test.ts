import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';
import { Webhooks } from '@paddle/paddle-node-sdk';
import { adjustmentEvent, subscriptionEvent, transactionEvent } from '@/test/paddle-events';
import type { PaddleAdjustment } from '@/server/integrations/paddle/list-adjustments';
import type { PaddleSubscription } from '@/server/integrations/paddle/get-subscription';
import type { PaddleTransaction } from '@/server/integrations/paddle/list-transactions';
import { syncCustomer } from './customer-access';
import { reconcileCustomer, resetRecoveryAlerts } from './reconcile-customer';
import { applyPaddleEvent } from './apply-paddle-event';

let deps: FakeBillingDeps;

const OCTOBER = new Date('2026-10-01T00:00:00Z');

/** Sets ctm_1's subscription as Paddle's newest event left it (status is Paddle's). */
async function record({ status, graceStartedAt }: { status?: string; graceStartedAt?: Date } = {}) {
  memory.subscribe('ctm_1', { status, graceStartedAt });
}

/** Starts the customer's access as the webhook does. */
async function startAccess() {
  await record();
  await syncCustomer('ctm_1', deps);
  vi.clearAllMocks();
}

describe('reconcileCustomer', () => {
  beforeEach(() => {
    deps = fakeBillingDeps();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:10:00Z'));
    memory.reset();
    memory.state.emails.set('ctm_1', 'buyer@example.com');
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

    expect(memory.state.access.get('ctm_1')).toBe('lapsed');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(deps.sendEmail).toHaveBeenCalledOnce();
  });

  it('changes nothing for an entitled customer whose licence is in place', async () => {
    await startAccess();

    await expect(reconcileCustomer('ctm_1', deps)).resolves.toEqual({
      access: 'unchanged',
      licence: 'current',
      subscriptionsRecovered: 0,
      paymentsRecovered: 0,
      adjustmentsRecovered: 0,
    });
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  describe('subscription notifications that were lost', () => {
    // sub_1 as Paddle's API returns it: the same entity a subscription notification carries.
    const inPaddle = (status: 'active' | 'past_due' | 'canceled', updatedAt: string) =>
      Webhooks.fromJson(
        subscriptionEvent({
          eventId: `evt_${status}`,
          status,
          subscriptionId: 'sub_1',
          customerId: 'ctm_1',
          occurredAt: updatedAt,
        }) as unknown as Parameters<typeof Webhooks.fromJson>[0],
      ).data as unknown as PaddleSubscription;

    it('records a cancellation the webhook never applied, ending access, and tells the operator', async () => {
      await startAccess();
      vi.setSystemTime(new Date('2026-10-03T04:00:00Z'));
      deps.getSubscription.mockResolvedValue(inPaddle('canceled', '2026-10-02T09:00:00Z'));

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({
        access: 'ended',
        subscriptionsRecovered: 1,
      });

      expect(deps.getSubscription).toHaveBeenCalledExactlyOnceWith('sub_1');
      expect(memory.state.subscriptions.get('sub_1')).toMatchObject({
        status: 'canceled',
        endedAt: '2026-10-02T09:00:00Z',
        occurredAt: '2026-10-02T09:00:00Z',
      });
      expect(memory.state.access.get('ctm_1')).toBe('lapsed');
      expect(deps.sendEmail).toHaveBeenCalledOnce();
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Recovered 1 subscription status for customer ctm_1',
        expect.stringContaining('sub_1 (recorded active, now canceled)'),
      );
    });

    it('starts grace from when Paddle last updated a past-due subscription, and says so', async () => {
      await startAccess();
      vi.setSystemTime(new Date('2026-10-03T04:00:00Z'));
      deps.getSubscription.mockResolvedValue(inPaddle('past_due', '2026-10-02T09:00:00Z'));

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ subscriptionsRecovered: 1 });

      expect(memory.state.subscriptions.get('sub_1')?.graceStartedAt).toBe('2026-10-02T09:00:00Z');
      expect(memory.state.access.get('ctm_1')).toBe('grace');
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Recovered 1 subscription status for customer ctm_1',
        expect.stringContaining('in grace from when Paddle last updated it'),
      );
    });

    it('keeps an event recorded after Paddle last updated the subscription, and alerts nothing', async () => {
      await startAccess();
      deps.getSubscription.mockResolvedValue(inPaddle('canceled', '2026-09-30T00:00:00Z'));

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({
        access: 'unchanged',
        subscriptionsRecovered: 0,
      });
      expect(memory.state.subscriptions.get('sub_1')?.status).toBe('active');
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('asks Paddle only about Pro subscriptions that may entitle', async () => {
      await startAccess();
      memory.subscribe('ctm_1', { subscriptionId: 'sub_ended', status: 'canceled' });
      memory.subscribe('ctm_1', { subscriptionId: 'sub_paused', status: 'paused' });
      memory.subscribe('ctm_1', { subscriptionId: 'sub_other', productId: 'pro_02' });
      memory.subscribe('ctm_1', { subscriptionId: 'sub_trial', status: 'trialing' });

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ subscriptionsRecovered: 0 });
      expect(deps.getSubscription.mock.calls.map(([id]) => id).sort()).toEqual(['sub_1', 'sub_trial']);
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('tells the operator about a subscription Paddle holds under another customer, and leaves it as recorded', async () => {
      await startAccess();
      deps.getSubscription.mockResolvedValue({ ...inPaddle('canceled', '2026-10-02T09:00:00Z'), customerId: 'ctm_2' });

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({
        access: 'unchanged',
        subscriptionsRecovered: 0,
      });
      expect(memory.state.subscriptions.get('sub_1')).toMatchObject({ customerId: 'ctm_1', status: 'active' });
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Subscription sub_1 is under another customer in Paddle',
        expect.stringMatching(/recorded for customer ctm_1, but Paddle holds it under customer ctm_2/),
      );
    });

    it('carries on when Paddle cannot be asked about subscriptions', async () => {
      await startAccess();
      deps.getSubscription.mockRejectedValue(new Error('Paddle unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({
        access: 'unchanged',
        subscriptionsRecovered: null,
        paymentsRecovered: 0,
      });
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Reconcile cannot reach Paddle',
        expect.stringContaining('Paddle unavailable'),
      );
    });
  });

  describe('paid time served after the subscription ended', () => {
    async function pay(transactionId: string, startsAt: string, endsAt: string) {
      await memory.store.recordPayment({
        transactionId,
        customerId: 'ctm_1',
        subscriptionId: 'sub_1',
        origin: 'subscription_recurring',
        priceId: 'pri_01month',
        billingInterval: 'month',
        billingFrequency: 1,
        periodStartsAt: startsAt,
        periodEndsAt: endsAt,
        subtotal: 3900,
        discount: 0,
        total: 3900,
        tax: 0,
        currencyCode: 'GBP',
        occurredAt: startsAt,
      });
    }
    const month = (n: number) => new Date(Date.UTC(2026, n, 1)).toISOString();

    it('vests a customer cancelled at once in month 12 with nothing refunded, once the paid month is served', async () => {
      for (let n = 0; n < 12; n++) await pay(`txn_${n}`, month(n), month(n + 1));
      vi.setSystemTime(new Date('2026-12-10T00:00:00Z'));
      memory.subscribe('ctm_1', { status: 'canceled' });
      await syncCustomer('ctm_1', deps);
      expect(memory.state.access.get('ctm_1')).toBe('lapsed');
      expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toBeNull();

      // Lapsed, but December is paid for: reconcile keeps visiting until it has been served.
      vi.setSystemTime(new Date('2026-12-31T04:00:00Z'));
      expect(await memory.store.customersToReconcile()).toContain('ctm_1');
      vi.setSystemTime(new Date('2027-01-01T04:00:00Z'));
      expect(await memory.store.customersToReconcile()).toContain('ctm_1');
      await reconcileCustomer('ctm_1', deps);

      expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));
      vi.setSystemTime(new Date('2027-01-04T04:00:00Z'));
      expect(await memory.store.customersToReconcile()).not.toContain('ctm_1');
    });

    it('moves a vested customer’s date to the end of the month they paid for when they cancel mid-month', async () => {
      for (let n = 0; n < 14; n++) await pay(`txn_${n}`, month(n), month(n + 1));
      vi.setSystemTime(new Date('2027-02-10T00:00:00Z'));
      memory.subscribe('ctm_1', { status: 'canceled' });
      await syncCustomer('ctm_1', deps);
      expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-02-10T00:00:00Z'));

      vi.setSystemTime(new Date('2027-03-01T04:00:00Z'));
      expect(await memory.store.customersToReconcile()).toContain('ctm_1');
      await reconcileCustomer('ctm_1', deps);

      expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-03-01T00:00:00Z'));
    });
  });

  describe('refunds and chargebacks whose notification was lost', () => {
    const listedAdjustment = (eventId: string, extra: Partial<Parameters<typeof adjustmentEvent>[0]> = {}) =>
      Webhooks.fromJson(
        adjustmentEvent({
          eventId,
          action: 'refund',
          status: 'approved',
          customerId: 'ctm_1',
          subscriptionId: 'sub_1',
          transactionId: 'txn_kept',
          occurredAt: '2026-09-20T00:00:00Z',
          ...extra,
        }) as unknown as Parameters<typeof Webhooks.fromJson>[0],
      ).data as unknown as PaddleAdjustment;

    beforeEach(async () => {
      await memory.store.recordPayment({
        transactionId: 'txn_kept',
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
        tax: 0,
        currencyCode: 'GBP',
        occurredAt: '2026-09-01T00:05:00Z',
      });
    });

    it('records an adjustment Paddle lists that the ledger is missing, as the webhook would, and counts it', async () => {
      await startAccess();
      deps.listAdjustments.mockResolvedValue([listedAdjustment('lost', { subtotal: '1950', type: 'partial' })]);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 1 });

      expect(deps.listAdjustments).toHaveBeenCalledWith(['sub_1']);
      expect([...memory.state.adjustments.values()]).toEqual([
        expect.objectContaining({ adjustmentId: 'adj_lost', status: 'approved', amount: 1950, currencyCode: 'GBP' }),
      ]);
      expect(memory.state.payments.get('txn_kept')?.status).toBe('partially_refunded');
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Recovered 1 adjustment for customer ctm_1',
        expect.stringContaining('adj_lost'),
      );
    });

    it('records a status change it missed, and nothing it already has or that is older than the recovery window', async () => {
      await startAccess();
      await memory.store.recordPaymentAdjustment({
        adjustmentId: 'adj_pending',
        transactionId: 'txn_kept',
        customerId: 'ctm_1',
        subscriptionId: 'sub_1',
        action: 'refund',
        type: 'full',
        itemTypes: ['full'],
        status: 'pending_approval',
        amount: 3900,
        currencyCode: 'GBP',
        createdAt: '2026-09-15T00:00:00Z',
        updatedAt: '2026-09-15T00:00:00Z',
        occurredAt: '2026-09-15T00:00:00Z',
      });
      deps.listAdjustments.mockResolvedValue([
        listedAdjustment('pending', { createdAt: '2026-09-15T00:00:00Z', occurredAt: '2026-09-18T00:00:00Z' }),
        listedAdjustment('ancient', { createdAt: '2026-01-01T00:00:00Z', occurredAt: '2026-01-02T00:00:00Z' }),
      ]);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 1 });
      expect(memory.state.adjustments.get('adj_pending')).toMatchObject({ status: 'approved' });
      expect(memory.state.adjustments.has('adj_ancient')).toBe(false);

      vi.clearAllMocks();
      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 0 });
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('cancels the subscription after a recovered full refund of the latest paid period, as the webhook would', async () => {
      await startAccess();
      deps.listAdjustments.mockResolvedValue([listedAdjustment('lost')]);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 1 });

      expect(deps.cancelSubscriptionNow).toHaveBeenCalledExactlyOnceWith('sub_1');
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Subscription sub_1 cancelled after a refund',
        expect.any(String),
      );
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Recovered 1 adjustment for customer ctm_1',
        expect.not.stringContaining('cancelled'),
      );

      // Acted on now, so a later reconcile does not act on it again.
      vi.clearAllMocks();
      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 0 });
      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
    });

    it('cancels nothing after a recovered partial refund, and tells the operator', async () => {
      await startAccess();
      deps.listAdjustments.mockResolvedValue([listedAdjustment('partial', { subtotal: '1950', type: 'partial' })]);

      await reconcileCustomer('ctm_1', deps);

      expect(deps.cancelSubscriptionNow).not.toHaveBeenCalled();
      expect(deps.alertOperator).toHaveBeenCalledWith('Paddle refund for customer ctm_1', expect.any(String));
    });

    it('fails when acting on a recovered chargeback fails, and acts on it when the job is retried', async () => {
      await startAccess();
      deps.listAdjustments.mockResolvedValue([listedAdjustment('chargeback', { action: 'chargeback' })]);
      deps.cancelSubscriptionNow.mockRejectedValueOnce(new Error('Paddle unavailable'));

      await expect(reconcileCustomer('ctm_1', deps)).rejects.toThrow('Paddle unavailable');
      expect(memory.state.adjustments.get('adj_chargeback')).toMatchObject({ status: 'approved' });

      // Recorded by the failed attempt, so the retry does not recover it, but still acts on it.
      vi.clearAllMocks();
      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 0 });
      expect(deps.cancelSubscriptionNow).toHaveBeenCalledExactlyOnceWith('sub_1');
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Subscription sub_1 cancelled after a chargeback',
        expect.any(String),
      );
    });

    // The partial refund's notification, with the status Paddle lists.
    const partialRefundNotification = () =>
      applyPaddleEvent(
        Webhooks.fromJson(
          adjustmentEvent({
            eventId: 'partial',
            action: 'refund',
            type: 'partial',
            subtotal: '1950',
            status: 'approved',
            customerId: 'ctm_1',
            subscriptionId: 'sub_1',
            transactionId: 'txn_kept',
            occurredAt: '2026-09-20T00:00:01Z',
          }) as unknown as Parameters<typeof Webhooks.fromJson>[0],
        ),
        deps,
      );

    it('acts on an adjustment once when reconcile gets to it before its notification', async () => {
      await startAccess();
      deps.listAdjustments.mockResolvedValue([listedAdjustment('partial', { subtotal: '1950', type: 'partial' })]);

      await reconcileCustomer('ctm_1', deps);
      expect(deps.alertOperator).toHaveBeenCalledWith(
        'Recovered 1 adjustment for customer ctm_1',
        expect.stringContaining('or are still on their way'),
      );
      expect(deps.alertOperator).toHaveBeenCalledWith('Paddle refund for customer ctm_1', expect.any(String));

      // Its notification, queued behind the reconcile, arrives with the same status.
      vi.clearAllMocks();
      await partialRefundNotification();
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('acts on an adjustment once when its notification gets to it before reconcile', async () => {
      await startAccess();
      await partialRefundNotification();
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Paddle refund for customer ctm_1',
        expect.any(String),
      );

      // Paddle then lists it with the same status.
      vi.clearAllMocks();
      deps.listAdjustments.mockResolvedValue([listedAdjustment('partial', { subtotal: '1950', type: 'partial' })]);
      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: 0 });
      expect(deps.alertOperator).not.toHaveBeenCalled();
    });

    it('visits a lapsed customer until an adjustment their failed notification recorded is acted on', async () => {
      await startAccess();
      await record({ status: 'canceled' });
      vi.setSystemTime(new Date('2026-11-01T04:00:00Z'));
      await syncCustomer('ctm_1', deps);
      expect(memory.state.access.get('ctm_1')).toBe('lapsed');
      expect(await memory.store.customersToReconcile()).not.toContain('ctm_1');

      // The notification records the refund, then fails before acting on it.
      deps.alertOperator.mockRejectedValue(new Error('Email unavailable'));
      await expect(partialRefundNotification()).rejects.toThrow('Email unavailable');
      expect(await memory.store.customersToReconcile()).toContain('ctm_1');

      deps.alertOperator.mockReset();
      await reconcileCustomer('ctm_1', deps);
      expect(deps.alertOperator).toHaveBeenCalledWith('Paddle refund for customer ctm_1', expect.any(String));
      expect(await memory.store.customersToReconcile()).not.toContain('ctm_1');
    });

    it('carries on when Paddle cannot list adjustments', async () => {
      await startAccess();
      deps.listAdjustments.mockRejectedValue(new Error('Paddle unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ adjustmentsRecovered: null });
      expect(deps.alertOperator).toHaveBeenCalledWith('Reconcile cannot reach Paddle', expect.any(String));
    });
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
        tax: 0,
        currencyCode: 'GBP',
        occurredAt: '2026-09-01T00:05:00Z',
      });

      await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ paymentsRecovered: 1 });

      expect(deps.listCompletedTransactions).toHaveBeenCalledWith(['sub_1'], expect.any(Date));
      expect([...memory.state.payments.keys()].sort()).toEqual(['txn_october', 'txn_september']);
      // The recovered month is in the paid time the reconcile stores.
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

    it('records a recovered payment as the webhook would have, with what it charged before tax', async () => {
      const event = transactionEvent({
        eventId: 'evt_taxed',
        transactionId: 'txn_taxed',
        customerId: 'ctm_1',
        subscriptionId: 'sub_1',
        occurredAt: '2026-09-01T00:00:00Z',
        total: '4680',
        tax: '780',
        period: { startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' },
      });
      const transaction = Webhooks.fromJson(event as unknown as Parameters<typeof Webhooks.fromJson>[0])
        .data as unknown as PaddleTransaction;

      await startAccess();
      deps.listCompletedTransactions.mockResolvedValue([transaction]);
      await reconcileCustomer('ctm_1', deps);
      const recovered = memory.state.payments.get('txn_taxed');

      memory.state.payments.clear();
      await applyPaddleEvent(Webhooks.fromJson(event as unknown as Parameters<typeof Webhooks.fromJson>[0]), deps);
      const delivered = memory.state.payments.get('txn_taxed');

      expect(recovered).toMatchObject({ total: 4680, tax: 780 });
      expect({ ...recovered, occurredAt: null }).toEqual({ ...delivered, occurredAt: null });
      expect((await memory.store.listPayments('ctm_1'))[0].charged).toBe(3900);
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

      expect(memory.state.access.get('ctm_1')).toBe('lapsed');
      expect(deps.alertOperator).toHaveBeenCalledExactlyOnceWith(
        'Reconcile cannot reach Paddle',
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

  it('restores access recorded as ended while a subscription still entitles the customer', async () => {
    await record();
    memory.state.access.set('ctm_1', 'lapsed');

    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ access: 'started', licence: 'issued' });
    expect(memory.state.access.get('ctm_1')).toBe('active');
  });

  it('issues a licence withheld in manual mode once provisioning is automated', async () => {
    deps.config = testServerConfig({ provisioning: 'manual' });
    await record();
    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ access: 'started', licence: null });
    expect(memory.licences('ctm_1')).toEqual([]);

    deps.config = testServerConfig({ provisioning: 'auto' });
    await expect(reconcileCustomer('ctm_1', deps)).resolves.toMatchObject({ access: 'unchanged', licence: 'issued' });
    expect(memory.licences('ctm_1')).toHaveLength(1);
  });
});
