import type {
  AccessStatus,
  Entitlement,
  PaymentAdjustmentEvent,
  PaymentEvent,
  PaymentStatus,
  SubscriptionEvent,
} from '@/server/db/billing-store';
import type { BillingStore } from '@/server/billing/deps';
import { chargedBeforeTax } from '@/server/db/payment-amounts';

/**
 * In-memory stand-in for billing-store.ts, for tests that follow a customer's access through several
 * events. `recordCustomerEvent`, `recordSubscriptionEvent`, `recordLicenceFailure`, `recordPayment`,
 * `recordPaymentAdjustment`, `saveCustomerState` and `customersToReconcile` behave as the database functions they
 * call do (tested in supabase/tests/database).
 */
interface Licence {
  customerId: string;
  jwt: string;
}

/** A recorded adjustment, with the times record_payment_adjustment derives. */
interface StoredAdjustment extends PaymentAdjustmentEvent {
  approvedAt: string | null;
  reversedAt: string | null;
}

const state = {
  /** The recorded customers' emails: a customer is recorded once it has an email here. */
  emails: new Map<string, string>(),
  /** When each customer's last applied event occurred (customers.last_event_at). */
  customerEventAt: new Map<string, string>(),
  /** Each subscription as its last applied event described it, with the grace start the database keeps. */
  subscriptions: new Map<string, SubscriptionEvent & { graceStartedAt: string | null }>(),
  /** Each customer's access (active_subscriptions.access_status). */
  access: new Map<string, AccessStatus>(),
  licences: [] as Licence[],
  licenceFailures: new Map<string, { attempts: number; lastError: string }>(),
  /** The payment ledger, by transaction id, with each payment's status as the last recompute stored it. */
  payments: new Map<string, PaymentEvent & { status: PaymentStatus }>(),
  adjustments: new Map<string, StoredAdjustment>(),
  /** Each customer's last stored state: their run (active_subscriptions) and grants (vested_entitlements). */
  entitlementStates: new Map<string, Entitlement>(),
};

/** The customer's licences, oldest first. */
function licences(customerId: string): Licence[] {
  return state.licences.filter((licence) => licence.customerId === customerId);
}

export const memory = {
  state,
  licences,

  reset() {
    state.emails.clear();
    state.customerEventAt.clear();
    state.subscriptions.clear();
    state.access.clear();
    state.licences.length = 0;
    state.licenceFailures.clear();
    state.payments.clear();
    state.adjustments.clear();
    state.entitlementStates.clear();
  },

  /**
   * Sets a subscription as a Paddle event would leave it, without the event's ordering: a test's shortcut to a
   * customer's subscriptions. `status` is Paddle's; a past-due one is in grace from `graceStartedAt`.
   */
  subscribe(
    customerId: string,
    subscription: { subscriptionId?: string; status?: string; graceStartedAt?: Date | null; productId?: string } = {},
  ) {
    const { subscriptionId = 'sub_1', status = 'active', graceStartedAt = null, productId = 'pro_01' } = subscription;
    state.subscriptions.set(subscriptionId, {
      subscriptionId,
      customerId,
      status: status as SubscriptionEvent['status'],
      priceId: 'pri_01month',
      productId,
      scheduledChangeAt: null,
      scheduledChangeAction: null,
      currentPeriodEndsAt: null,
      endedAt: status === 'canceled' || status === 'paused' ? new Date().toISOString() : null,
      occurredAt: new Date().toISOString(),
      graceStartedAt: status === 'past_due' ? (graceStartedAt ?? new Date()).toISOString() : null,
    });
  },

  store: {
    async getCustomerEmail(customerId: string) {
      return state.emails.get(customerId) ?? null;
    },

    async recordCustomerEvent(event: { customerId: string; email: string; occurredAt: string }) {
      if (isOlder(event.occurredAt, state.customerEventAt.get(event.customerId))) return false;
      state.customerEventAt.set(event.customerId, event.occurredAt);
      state.emails.set(event.customerId, event.email);
      return true;
    },

    async recordSubscriptionEvent(event: SubscriptionEvent) {
      requireCustomer(event.customerId, 'subscriptions');
      const existing = state.subscriptions.get(event.subscriptionId);
      if (isOlder(event.occurredAt, existing?.occurredAt)) return false;
      // As record_subscription_event does: a past-due subscription keeps its first past-due event's time.
      const graceStartedAt = event.status === 'past_due' ? (existing?.graceStartedAt ?? event.occurredAt) : null;
      state.subscriptions.set(event.subscriptionId, { ...event, graceStartedAt });
      return true;
    },

    async hasLicence(customerId: string) {
      return licences(customerId).length > 0;
    },

    async recordLicence(params: { customerId: string; jwt: string }) {
      state.licences.push({ ...params });
    },

    async recordLicenceFailure(customerId: string, error: string) {
      const attempts = (state.licenceFailures.get(customerId)?.attempts ?? 0) + 1;
      state.licenceFailures.set(customerId, { attempts, lastError: error });
      return attempts === 1;
    },

    async clearLicenceFailure(customerId: string) {
      state.licenceFailures.delete(customerId);
    },

    async customersToReconcile() {
      const entitled = (status: AccessStatus) => status === 'active' || status === 'grace';
      const customers = new Set([
        ...[...state.access].filter(([, status]) => entitled(status)).map(([customerId]) => customerId),
        ...[...state.subscriptions.values()]
          .filter((subscription) => ['active', 'trialing', 'past_due'].includes(subscription.status))
          .map((subscription) => subscription.customerId),
        ...state.licenceFailures.keys(),
        ...[...state.entitlementStates]
          .filter(([, entitlement]) => entitlement.run || entitlement.grants.some((g) => g.status === 'conditional'))
          .map(([customerId]) => customerId),
        // Paid time still being served, or served within two days (20261005130000_reconcile_paid_time.sql).
        ...[...state.payments.values()]
          .filter((payment) => new Date(payment.periodEndsAt).getTime() > Date.now() - 2 * 24 * 60 * 60 * 1000)
          .map((payment) => payment.customerId),
      ]);
      return [...customers].sort();
    },

    async recordPayment(event: PaymentEvent) {
      requireCustomer(event.customerId, 'payments');
      const existing = state.payments.get(event.transactionId);
      if (existing && isOlder(event.occurredAt, existing.occurredAt)) return false;
      state.payments.set(event.transactionId, { ...event, status: existing?.status ?? 'paid' });
      return true;
    },

    async recordPaymentAdjustment(event: PaymentAdjustmentEvent) {
      requireCustomer(event.customerId, 'payment_adjustments');
      const existing = state.adjustments.get(event.adjustmentId);
      const approvedAt =
        event.status === 'approved' ? event.updatedAt : event.status === 'reversed' ? event.createdAt : null;
      const reversedAt = event.status === 'reversed' ? event.updatedAt : null;
      const newer = !existing || !isOlder(event.occurredAt, existing.occurredAt);

      const fillsAmount = existing !== undefined && existing.amount === null && event.amount !== null;
      if (!newer && !fillsAmount && (existing.approvedAt || !approvedAt) && (existing.reversedAt || !reversedAt)) {
        return false;
      }
      state.adjustments.set(event.adjustmentId, {
        ...(newer ? event : existing),
        // As record_payment_adjustment does: an amount, once known, is kept.
        amount: existing?.amount ?? event.amount,
        currencyCode: existing?.currencyCode ?? event.currencyCode,
        approvedAt: existing?.approvedAt ?? approvedAt,
        reversedAt: existing?.reversedAt ?? reversedAt,
      });
      return true;
    },

    async listPayments(customerId: string) {
      return [...state.payments.values()]
        .filter((payment) => payment.customerId === customerId)
        .map((payment) => ({
          transactionId: payment.transactionId,
          subscriptionId: payment.subscriptionId,
          billingInterval: payment.billingInterval,
          billingFrequency: payment.billingFrequency,
          periodStartsAt: new Date(payment.periodStartsAt),
          periodEndsAt: new Date(payment.periodEndsAt),
          charged: chargedBeforeTax(payment),
        }));
    },

    async listPaymentAdjustments(customerId: string) {
      return [...state.adjustments.values()]
        .filter((adjustment) => adjustment.customerId === customerId)
        .map((adjustment) => ({
          adjustmentId: adjustment.adjustmentId,
          transactionId: adjustment.transactionId,
          action: adjustment.action,
          type: adjustment.type,
          itemTypes: adjustment.itemTypes,
          status: adjustment.status,
          approvedAt: adjustment.approvedAt ? new Date(adjustment.approvedAt) : null,
          reversedAt: adjustment.reversedAt ? new Date(adjustment.reversedAt) : null,
          amount: adjustment.amount,
        }));
    },

    async listSubscriptions(customerId: string) {
      return [...state.subscriptions.values()]
        .filter((subscription) => subscription.customerId === customerId)
        .map((subscription) => ({
          subscriptionId: subscription.subscriptionId,
          productId: subscription.productId,
          status: subscription.status,
          graceStartedAt: subscription.graceStartedAt ? new Date(subscription.graceStartedAt) : null,
          endedAt: subscription.endedAt ? new Date(subscription.endedAt) : null,
        }));
    },

    async listGrants(customerId: string) {
      return (state.entitlementStates.get(customerId)?.grants ?? []).map((grant) => ({ ...grant }));
    },

    // As set_customer_entitlement does: returns the access it replaced.
    async saveCustomerState(customerId: string, entitlement: Entitlement) {
      const previous = state.access.get(customerId);
      state.access.set(customerId, entitlement.access.status);
      state.entitlementStates.set(customerId, entitlement);
      for (const [transactionId, paymentStatus] of Object.entries(entitlement.paymentStatuses)) {
        const payment = state.payments.get(transactionId);
        if (payment?.customerId === customerId) payment.status = paymentStatus;
      }
      return previous ?? 'lapsed';
    },
  } satisfies BillingStore,
};

// As the customers foreign key on each table does: a row for a customer not recorded yet fails, so the job is retried.
function requireCustomer(customerId: string, table: string) {
  if (!state.emails.has(customerId)) {
    throw Object.assign(new Error(`violates foreign key constraint "${table}_customer_id_fkey"`), { code: '23503' });
  }
}

// Whether an event occurred before the last one applied: the database applies an event unless it is older.
function isOlder(occurredAt: string, lastAppliedAt: string | undefined): boolean {
  return lastAppliedAt !== undefined && new Date(occurredAt) < new Date(lastAppliedAt);
}
