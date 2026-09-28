import type { PaddleEventJson } from '@/utils/webhooks/inbox';

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
      scheduled_change: null,
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
