import type { PaddleEventJson } from '@/server/db/customer-jobs';

/** Paddle notification bodies shaped like real deliveries, for tests that rebuild them with the SDK. */

export function subscriptionEvent(options: {
  eventId: string;
  eventType?: string;
  occurredAt: string;
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled';
  subscriptionId?: string;
  customerId?: string;
  productId?: string;
  periodEndsAt?: string;
  /** When set, the subscription is scheduled to cancel then. */
  cancelsAt?: string;
}): PaddleEventJson {
  const { eventId, occurredAt, status } = options;
  const productId = options.productId ?? 'pro_01';
  const periodEndsAt = options.periodEndsAt ?? '2026-10-01T00:00:00Z';

  return {
    event_id: eventId,
    event_type: options.eventType ?? 'subscription.updated',
    occurred_at: occurredAt,
    notification_id: `ntf_${eventId}`,
    data: {
      id: options.subscriptionId ?? 'sub_01',
      status,
      customer_id: options.customerId ?? 'ctm_01',
      address_id: 'add_01',
      business_id: null,
      currency_code: 'GBP',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: occurredAt,
      started_at: '2026-09-01T00:00:00Z',
      first_billed_at: '2026-09-01T00:00:00Z',
      next_billed_at: status === 'canceled' ? null : periodEndsAt,
      paused_at: null,
      canceled_at: status === 'canceled' ? occurredAt : null,
      discount: null,
      collection_mode: 'automatic',
      billing_details: null,
      current_billing_period:
        status === 'canceled' ? null : { starts_at: '2026-09-01T00:00:00Z', ends_at: periodEndsAt },
      billing_cycle: { interval: 'month', frequency: 1 },
      scheduled_change: options.cancelsAt
        ? { action: 'cancel', effective_at: options.cancelsAt, resume_at: null }
        : null,
      items: [
        {
          status: 'active',
          quantity: 1,
          recurring: true,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: occurredAt,
          previously_billed_at: '2026-09-01T00:00:00Z',
          next_billed_at: null,
          trial_dates: null,
          price: {
            id: 'pri_01',
            product_id: productId,
            description: 'Tenantry Pro monthly',
            type: 'standard',
            name: 'Monthly',
            billing_cycle: { interval: 'month', frequency: 1 },
            trial_period: null,
            tax_mode: 'account_setting',
            unit_price: { amount: '1500', currency_code: 'GBP' },
            unit_price_overrides: [],
            quantity: { minimum: 1, maximum: 1 },
            status: 'active',
            custom_data: null,
            import_meta: null,
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-01T00:00:00Z',
          },
        },
      ],
      custom_data: null,
      import_meta: null,
    },
  } as PaddleEventJson;
}

export function customerEvent(options: {
  eventId: string;
  eventType?: string;
  occurredAt: string;
  customerId?: string;
  email: string;
}): PaddleEventJson {
  return {
    event_id: options.eventId,
    event_type: options.eventType ?? 'customer.created',
    occurred_at: options.occurredAt,
    notification_id: `ntf_${options.eventId}`,
    data: {
      id: options.customerId ?? 'ctm_01',
      name: null,
      email: options.email,
      marketing_consent: false,
      status: 'active',
      locale: 'en',
      custom_data: null,
      import_meta: null,
      created_at: options.occurredAt,
      updated_at: options.occurredAt,
    },
  } as PaddleEventJson;
}

/** An adjustment notification (a refund, credit or chargeback on a transaction). */
export function adjustmentEvent(options: {
  eventId: string;
  eventType?: 'adjustment.created' | 'adjustment.updated';
  occurredAt?: string;
  action: 'refund' | 'credit' | 'chargeback' | 'chargeback_warning' | 'chargeback_reverse';
  type?: 'full' | 'partial';
  status: 'pending_approval' | 'approved' | 'rejected' | 'reversed';
  subscriptionId?: string | null;
  customerId?: string;
  transactionId?: string;
  /** The items' type, when it differs from the adjustment's (tax, proration). */
  itemType?: 'full' | 'partial' | 'tax' | 'proration';
  /** Paddle's created_at on the adjustment, when it was created before this event. */
  createdAt?: string;
  /** What it returns before tax (totals.subtotal), in the lowest unit. */
  subtotal?: string;
}): PaddleEventJson {
  const occurredAt = options.occurredAt ?? '2026-09-10T00:00:00Z';
  const subtotal = options.subtotal ?? '3900';
  const totals = {
    subtotal,
    tax: '0',
    total: subtotal,
    fee: '0',
    earnings: subtotal,
    retained_fee: '0',
    currency_code: 'GBP',
  };

  return {
    event_id: options.eventId,
    event_type: options.eventType ?? 'adjustment.updated',
    occurred_at: occurredAt,
    notification_id: `ntf_${options.eventId}`,
    data: {
      id: `adj_${options.eventId}`,
      action: options.action,
      type: options.type ?? 'full',
      transaction_id: options.transactionId ?? 'txn_01',
      subscription_id: options.subscriptionId === undefined ? 'sub_01' : options.subscriptionId,
      customer_id: options.customerId ?? 'ctm_01',
      reason: 'requested by customer',
      credit_applied_to_balance: false,
      currency_code: 'GBP',
      status: options.status,
      items: [
        {
          id: 'adjitm_01',
          item_id: 'txnitm_01',
          type: options.itemType ?? options.type ?? 'full',
          amount: '3900',
          proration: null,
          totals,
        },
      ],
      totals,
      payout_totals: null,
      created_at: options.createdAt ?? occurredAt,
      updated_at: occurredAt,
    },
  } as unknown as PaddleEventJson;
}

/** A transaction notification: by default a completed monthly Pro renewal for September 2026. */
export function transactionEvent(options: {
  eventId: string;
  eventType?: string;
  occurredAt?: string;
  transactionId?: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  origin?: string;
  productId?: string;
  /** By default the offer price for the interval. */
  priceId?: string;
  interval?: 'month' | 'year';
  /** null for a transaction with no billing period (a one-time charge). */
  period?: { startsAt: string; endsAt: string } | null;
  total?: string;
  /** The tax within the total, if any. */
  tax?: string;
}): PaddleEventJson {
  const occurredAt = options.occurredAt ?? '2026-09-01T00:05:00Z';
  const interval = options.interval ?? 'month';
  const total = options.total ?? (interval === 'year' ? '39000' : '3900');
  const period =
    options.period === undefined
      ? { startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }
      : options.period;
  const price = {
    id: options.priceId ?? (interval === 'year' ? 'pri_01year' : 'pri_01month'),
    product_id: options.productId ?? 'pro_01',
    description: `Tenantry Pro ${interval}ly`,
    type: 'standard',
    name: interval === 'year' ? 'Yearly' : 'Monthly',
    billing_cycle: { interval, frequency: 1 },
    trial_period: null,
    tax_mode: 'account_setting',
    unit_price: { amount: total, currency_code: 'GBP' },
    unit_price_overrides: [],
    quantity: { minimum: 1, maximum: 1 },
    status: 'active',
    custom_data: null,
    import_meta: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
  const tax = options.tax ?? '0';
  const totals = {
    subtotal: String(Number(total) - Number(tax)),
    discount: '0',
    tax,
    total,
    credit: '0',
    credit_to_balance: '0',
    balance: '0',
    grand_total: total,
    grand_total_tax: '0',
    fee: '100',
    earnings: '3800',
    currency_code: 'GBP',
  };

  return {
    event_id: options.eventId,
    event_type: options.eventType ?? 'transaction.completed',
    occurred_at: occurredAt,
    notification_id: `ntf_${options.eventId}`,
    data: {
      id: options.transactionId ?? 'txn_01',
      status: 'completed',
      customer_id: options.customerId === undefined ? 'ctm_01' : options.customerId,
      address_id: 'add_01',
      business_id: null,
      custom_data: null,
      currency_code: 'GBP',
      origin: options.origin ?? 'subscription_recurring',
      subscription_id: options.subscriptionId === undefined ? 'sub_01' : options.subscriptionId,
      invoice_id: 'inv_01',
      invoice_number: '123-10001',
      collection_mode: 'automatic',
      discount_id: null,
      billing_details: null,
      billing_period: period ? { starts_at: period.startsAt, ends_at: period.endsAt } : null,
      items: [{ price_id: price.id, price, quantity: 1, proration: null }],
      details: {
        tax_rates_used: [],
        totals,
        adjusted_totals: null,
        payout_totals: null,
        adjusted_payout_totals: null,
        line_items: [],
      },
      payments: [],
      checkout: null,
      created_at: occurredAt,
      updated_at: occurredAt,
      billed_at: occurredAt,
      revised_at: null,
    },
  } as unknown as PaddleEventJson;
}
