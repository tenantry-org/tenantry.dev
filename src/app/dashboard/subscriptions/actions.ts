'use server';

import { validateUserSession } from '@/utils/supabase/server';
import { Subscription } from '@paddle/paddle-node-sdk';
import { revalidatePath } from 'next/cache';
import { getPaddleInstance } from '@/utils/paddle/get-paddle-instance';
import { getCustomerId } from '@/utils/paddle/get-customer-id';

interface Error {
  error: string;
}

export async function cancelSubscription(subscriptionId: string): Promise<Subscription | Error> {
  try {
    await validateUserSession();

    // Only the signed-in customer's own subscription: the id comes from the browser.
    const customerId = await getCustomerId();
    const paddle = getPaddleInstance();
    const existing = await paddle.subscriptions.get(subscriptionId);
    if (!customerId || existing.customerId !== customerId) return { error: 'Subscription not found' };

    const subscription = await paddle.subscriptions.cancel(subscriptionId, { effectiveFrom: 'next_billing_period' });
    if (subscription) {
      revalidatePath('/dashboard/subscriptions');
    }
    return JSON.parse(JSON.stringify(subscription));
  } catch (e) {
    console.log('Error canceling subscription', e);
    return { error: 'Something went wrong, please try again later' };
  }
}
