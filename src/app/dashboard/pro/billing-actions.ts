'use server';

import { revalidatePath } from 'next/cache';
import { Subscription } from '@paddle/paddle-node-sdk';
import { validateUserSession } from '@/server/db/user-client';
import { getPaddleInstance } from '@/server/integrations/paddle/get-paddle-instance';
import { getCustomerId } from '@/server/db/customer-dashboard';

type Result<T> = T | { error: string };

/** Where in Paddle's customer portal to send the customer. */
export type BillingPortalTarget = { kind: 'overview' } | { kind: 'cancel' | 'payment-method'; subscriptionId: string };

const UNAVAILABLE = 'Billing is unavailable right now, please try again later';

/**
 * A one-time link into Paddle's customer portal for the signed-in customer: its overview (invoices, invoice
 * details, payment methods), or a subscription's cancel or payment-method page. The customer comes from the
 * session, never from the browser, and a subscription must be theirs. Links expire, so each click gets a new one.
 */
export async function openBillingPortal(target: BillingPortalTarget): Promise<Result<{ url: string }>> {
  try {
    const customerId = await sessionCustomerId();
    if (!customerId) return { error: 'No Tenantry Pro billing account is linked to this login' };

    const subscriptionIds = target.kind === 'overview' ? [] : [target.subscriptionId];
    if (target.kind !== 'overview' && !(await ownSubscription(customerId, target.subscriptionId))) {
      return { error: 'Subscription not found' };
    }

    const session = await getPaddleInstance().customerPortalSessions.create(customerId, subscriptionIds);
    const links = session.urls.subscriptions[0];
    const url =
      target.kind === 'overview'
        ? session.urls.general.overview
        : target.kind === 'cancel'
          ? links?.cancelSubscription
          : links?.updateSubscriptionPaymentMethod;

    return url ? { url } : { error: UNAVAILABLE };
  } catch (e) {
    console.log('Error opening the billing portal', e);
    return { error: UNAVAILABLE };
  }
}

/**
 * Undoes a scheduled cancellation, so the subscription renews as normal. The portal offers the same
 * (Don't cancel); this saves the customer the trip there.
 */
export async function keepSubscription(subscriptionId: string): Promise<Result<{ kept: true }>> {
  try {
    const customerId = await sessionCustomerId();
    const existing = customerId ? await ownSubscription(customerId, subscriptionId) : null;
    if (!existing) return { error: 'Subscription not found' };
    if (existing.status === 'canceled' || existing.scheduledChange?.action !== 'cancel') {
      return { error: 'This subscription is not scheduled to cancel' };
    }

    await getPaddleInstance().subscriptions.update(subscriptionId, { scheduledChange: null });
    revalidatePath('/dashboard/pro', 'layout'); // Access, Install and Billing all show this customer's state
    return { kept: true };
  } catch (e) {
    console.log('Error keeping subscription', e);
    return { error: 'Something went wrong, please try again later' };
  }
}

async function sessionCustomerId(): Promise<string | null> {
  await validateUserSession();
  return getCustomerId();
}

// The subscription, if it belongs to the customer (its id comes from the browser), else null.
async function ownSubscription(customerId: string, subscriptionId: string): Promise<Subscription | null> {
  const subscription = await getPaddleInstance().subscriptions.get(subscriptionId);
  return subscription.customerId === customerId ? subscription : null;
}
