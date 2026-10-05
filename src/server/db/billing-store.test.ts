import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeCall, FakeTable } from '@/test/fake-supabase';
import {
  customersToReconcile,
  listGrants,
  listPaymentAdjustments,
  listPayments,
  listSubscriptions,
  recordCustomerEvent,
  recordPayment,
  recordPaymentAdjustment,
  recordSubscriptionEvent,
  saveCustomerState,
} from './billing-store';

// The queries and function calls the store makes, against a fake client. The billing services are tested against the
// in-memory store (src/test/memory-billing-store.ts), and the database functions in supabase/tests/database.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, FakeTable>,
  calls: [] as FakeCall[],
  applied: true,
  /** The error the database functions fail with, if any. */
  rpcError: null as { code: string; message: string } | null,
  customers: [] as string[],
}));
vi.mock('@/server/db/service-role-client', async () => {
  const { fakeSupabase } = await import('@/test/fake-supabase');
  return {
    createServiceRoleClient: () =>
      fakeSupabase(state.tables, state.calls, {
        record_customer_event: () => rpcResult(state.applied),
        record_subscription_event: () => rpcResult(state.applied),
        record_payment: () => rpcResult(state.applied),
        record_payment_adjustment: () => rpcResult(state.applied),
        set_customer_entitlement: () => rpcResult('lapsed'),
        customers_to_reconcile: () => rpcResult(state.customers),
      }),
  };
});

function rpcResult<T>(data: T): T {
  if (state.rpcError) throw state.rpcError;
  return data;
}

const rpcArgs = (name: string) => state.calls.find((call) => call.table === `rpc:${name}`)?.args[0];

beforeEach(() => {
  state.tables = {};
  state.calls.length = 0;
  state.applied = true;
  state.rpcError = null;
  state.customers = [];
});

describe('Paddle events', () => {
  it('records a subscription event with each of its fields', async () => {
    await expect(
      recordSubscriptionEvent({
        subscriptionId: 'sub_1',
        customerId: 'ctm_1',
        status: 'active',
        priceId: 'pri_1',
        productId: 'pro_1',
        scheduledChangeAt: '2026-10-01T00:00:00Z',
        scheduledChangeAction: 'cancel',
        currentPeriodEndsAt: null,
        endedAt: null,
        occurredAt: '2026-09-28T11:00:00Z',
      }),
    ).resolves.toBe(true);

    expect(rpcArgs('record_subscription_event')).toEqual({
      p_subscription_id: 'sub_1',
      p_customer_id: 'ctm_1',
      p_status: 'active',
      p_price_id: 'pri_1',
      p_product_id: 'pro_1',
      p_scheduled_change_at: '2026-10-01T00:00:00Z',
      p_scheduled_change_action: 'cancel',
      p_current_period_ends_at: null,
      p_ended_at: null,
      p_occurred_at: '2026-09-28T11:00:00Z',
    });
  });

  it('passes null for no scheduled change, and says when a newer event was applied already', async () => {
    state.applied = false;

    await expect(
      recordSubscriptionEvent({
        subscriptionId: 'sub_1',
        customerId: 'ctm_1',
        status: 'active',
        priceId: 'pri_1',
        productId: 'pro_1',
        scheduledChangeAt: null,
        scheduledChangeAction: null,
        currentPeriodEndsAt: null,
        endedAt: null,
        occurredAt: '2026-09-28T11:00:00Z',
      }),
    ).resolves.toBe(false);

    expect(rpcArgs('record_subscription_event')).toMatchObject({
      p_scheduled_change_at: null,
      p_scheduled_change_action: null,
    });
  });

  it("records a customer event's email and when it occurred", async () => {
    await expect(
      recordCustomerEvent({ customerId: 'ctm_1', email: 'buyer@example.com', occurredAt: '2026-09-29T10:00:00Z' }),
    ).resolves.toBe(true);

    expect(rpcArgs('record_customer_event')).toEqual({
      p_customer_id: 'ctm_1',
      p_email: 'buyer@example.com',
      p_occurred_at: '2026-09-29T10:00:00Z',
    });
  });

  // The worker retries an event whose recording throws; one that returned false would be completed as stale.
  it('throws when recording an event fails, such as a subscription whose customer is not recorded yet', async () => {
    state.rpcError = {
      code: '23503',
      message: 'violates foreign key constraint "subscriptions_customer_id_fkey"',
    };
    await expect(
      recordSubscriptionEvent({
        subscriptionId: 'sub_1',
        customerId: 'ctm_1',
        status: 'active',
        priceId: 'pri_1',
        productId: 'pro_1',
        scheduledChangeAt: null,
        scheduledChangeAction: null,
        currentPeriodEndsAt: null,
        endedAt: null,
        occurredAt: '2026-09-28T11:00:00Z',
      }),
    ).rejects.toMatchObject({ code: '23503' });

    state.rpcError = { code: '08006', message: 'connection failure' };
    await expect(
      recordCustomerEvent({ customerId: 'ctm_1', email: 'buyer@example.com', occurredAt: '2026-09-29T10:00:00Z' }),
    ).rejects.toMatchObject({ code: '08006' });
  });
});

describe('customers', () => {
  // One function call returns every customer to reconcile: separate table queries were each cut off at the API's
  // row limit (max_rows, 1000).
  it('reads every customer to reconcile in one call, beyond the API row limit', async () => {
    state.customers = Array.from({ length: 2500 }, (_, index) => `ctm_${String(index).padStart(4, '0')}`);

    await expect(customersToReconcile()).resolves.toHaveLength(2500);
    expect(state.calls).toEqual([{ table: 'rpc:customers_to_reconcile', method: 'rpc', args: [{}] }]);
  });
});

describe('the payment ledger', () => {
  it('records a payment with its period and amounts, and says whether it was applied', async () => {
    await expect(
      recordPayment({
        transactionId: 'txn_1',
        customerId: 'ctm_1',
        subscriptionId: 'sub_1',
        origin: 'subscription_recurring',
        priceId: 'pri_1',
        billingInterval: 'month',
        billingFrequency: 1,
        periodStartsAt: '2027-01-01T00:00:00Z',
        periodEndsAt: '2027-02-01T00:00:00Z',
        subtotal: 3900,
        discount: 0,
        total: 4680,
        tax: 780,
        currencyCode: 'GBP',
        occurredAt: '2027-01-01T00:05:00Z',
      }),
    ).resolves.toBe(true);

    expect(rpcArgs('record_payment')).toEqual({
      p_transaction_id: 'txn_1',
      p_customer_id: 'ctm_1',
      p_subscription_id: 'sub_1',
      p_origin: 'subscription_recurring',
      p_price_id: 'pri_1',
      p_billing_interval: 'month',
      p_billing_frequency: 1,
      p_period_starts_at: '2027-01-01T00:00:00Z',
      p_period_ends_at: '2027-02-01T00:00:00Z',
      p_subtotal: 3900,
      p_discount: 0,
      p_total: 4680,
      p_currency_code: 'GBP',
      p_tax: 780,
      p_occurred_at: '2027-01-01T00:05:00Z',
    });
  });

  it('records an adjustment with its item types and Paddle times, and fails as the database does', async () => {
    const adjustment = {
      adjustmentId: 'adj_1',
      transactionId: 'txn_1',
      customerId: 'ctm_1',
      subscriptionId: null,
      action: 'refund',
      type: 'partial',
      itemTypes: ['tax'],
      status: 'approved',
      amount: 0,
      currencyCode: 'GBP',
      createdAt: '2027-01-02T00:00:00Z',
      updatedAt: '2027-01-03T00:00:00Z',
      occurredAt: '2027-01-03T00:00:01Z',
    };
    await recordPaymentAdjustment(adjustment);

    expect(rpcArgs('record_payment_adjustment')).toMatchObject({
      p_adjustment_id: 'adj_1',
      p_subscription_id: null,
      p_item_types: ['tax'],
      p_subtotal: 0,
      p_currency_code: 'GBP',
      p_created_at: '2027-01-02T00:00:00Z',
      p_updated_at: '2027-01-03T00:00:00Z',
    });

    state.rpcError = { code: '23503', message: 'violates foreign key constraint' };
    await expect(recordPaymentAdjustment(adjustment)).rejects.toMatchObject({ code: '23503' });
  });

  it('reads payments, adjustments and subscriptions as the rules take them', async () => {
    state.tables.payments = {
      list: [
        {
          transaction_id: 'txn_1',
          subscription_id: 'sub_1',
          billing_interval: 'year',
          billing_frequency: 1,
          period_starts_at: '2027-01-01T00:00:00+00:00',
          period_ends_at: '2028-01-01T00:00:00+00:00',
          subtotal: 39000,
          discount: 0,
          total: 46800,
          tax: 7800,
        },
        // Recorded before tax was: subtotal less discount.
        {
          transaction_id: 'txn_0',
          subscription_id: 'sub_1',
          billing_interval: 'month',
          billing_frequency: 1,
          period_starts_at: '2026-12-01T00:00:00+00:00',
          period_ends_at: '2027-01-01T00:00:00+00:00',
          subtotal: 3900,
          discount: 1000,
          total: 3480,
          tax: null,
        },
      ],
    };
    state.tables.payment_adjustments = {
      list: [
        {
          adjustment_id: 'adj_1',
          transaction_id: 'txn_1',
          action: 'chargeback',
          type: 'full',
          item_types: ['full'],
          status: 'reversed',
          approved_at: '2027-02-01T00:00:00+00:00',
          reversed_at: '2027-03-01T00:00:00+00:00',
          subtotal: 39000,
        },
        {
          adjustment_id: 'adj_0',
          transaction_id: 'txn_0',
          action: 'refund',
          type: 'partial',
          item_types: ['partial'],
          status: 'approved',
          approved_at: '2027-01-02T00:00:00+00:00',
          reversed_at: null,
          subtotal: null,
        },
      ],
    };
    state.tables.subscriptions = {
      list: [
        {
          subscription_id: 'sub_1',
          product_id: 'pro_01',
          status: 'past_due',
          grace_started_at: '2027-01-01T00:00:00+00:00',
          ended_at: null,
        },
      ],
    };

    await expect(listPayments('ctm_1')).resolves.toEqual([
      {
        transactionId: 'txn_1',
        subscriptionId: 'sub_1',
        billingInterval: 'year',
        billingFrequency: 1,
        periodStartsAt: new Date('2027-01-01T00:00:00Z'),
        periodEndsAt: new Date('2028-01-01T00:00:00Z'),
        charged: 39000,
      },
      expect.objectContaining({ transactionId: 'txn_0', charged: 2900 }),
    ]);
    await expect(listPaymentAdjustments('ctm_1')).resolves.toEqual([
      expect.objectContaining({
        action: 'chargeback',
        amount: 39000,
        approvedAt: new Date('2027-02-01T00:00:00Z'),
        reversedAt: new Date('2027-03-01T00:00:00Z'),
      }),
      expect.objectContaining({ adjustmentId: 'adj_0', amount: null }),
    ]);
    await expect(listSubscriptions('ctm_1')).resolves.toEqual([
      {
        subscriptionId: 'sub_1',
        productId: 'pro_01',
        status: 'past_due',
        graceStartedAt: new Date('2027-01-01T00:00:00Z'),
        endedAt: null,
      },
    ]);
  });

  it('reads the computed grants as stored, leaving out operator grants', async () => {
    state.tables = {
      vested_entitlements: {
        list: [
          {
            kind: 'qualifying_run',
            started_at: '2026-01-01T00:00:00Z',
            vested_through: '2027-02-01T00:00:00Z',
            status: 'confirmed',
            confirmed_at: '2027-01-01T00:00:00Z',
            transaction_id: null,
            withdrawn_reason: null,
          },
        ],
      },
    };

    await expect(listGrants('ctm_1')).resolves.toEqual([
      {
        kind: 'qualifying_run',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        vestedThrough: new Date('2027-02-01T00:00:00Z'),
        status: 'confirmed',
        confirmedAt: new Date('2027-01-01T00:00:00Z'),
        transactionId: null,
        withdrawnReason: null,
      },
    ]);
    expect(state.calls).toContainEqual({ table: 'vested_entitlements', method: 'neq', args: ['kind', 'operator'] });
  });

  it('stores the derived state in one call and returns the access it replaced', async () => {
    await expect(
      saveCustomerState('ctm_1', {
        access: { status: 'active', graceEndsAt: null },
        run: {
          startedAt: new Date('2027-01-01T00:00:00Z'),
          paidThrough: new Date('2027-03-01T00:00:00Z'),
          monthsPaid: 2,
          vestsAt: new Date('2028-01-01T00:00:00Z'),
        },
        vestedThrough: null,
        grants: [
          {
            kind: 'annual_term',
            startedAt: new Date('2026-01-01T00:00:00Z'),
            vestedThrough: new Date('2027-01-01T00:00:00Z'),
            status: 'withdrawn',
            confirmedAt: null,
            transactionId: 'txn_0',
            withdrawnReason: 'refund',
          },
        ],
        paymentStatuses: { txn_0: 'refunded' },
        ambiguousReversals: [],
      }),
    ).resolves.toBe('lapsed');

    expect(rpcArgs('set_customer_entitlement')).toEqual({
      p_customer_id: 'ctm_1',
      p_state: {
        access_status: 'active',
        grace_ends_at: null,
        run_started_at: '2027-01-01T00:00:00.000Z',
        paid_through: '2027-03-01T00:00:00.000Z',
        months_paid: 2,
        vests_at: '2028-01-01T00:00:00.000Z',
      },
      p_grants: [
        {
          kind: 'annual_term',
          started_at: '2026-01-01T00:00:00.000Z',
          vested_through: '2027-01-01T00:00:00.000Z',
          status: 'withdrawn',
          confirmed_at: null,
          transaction_id: 'txn_0',
          withdrawn_reason: 'refund',
        },
      ],
      p_payment_statuses: { txn_0: 'refunded' },
    });
  });
});
