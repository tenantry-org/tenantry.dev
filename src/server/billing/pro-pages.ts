import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import type { Tables } from '@/lib/supabase/database.types';
import type { BillingInterval, OfferPrices } from '@/lib/public-config';
import { getCurrentUser } from '@/server/db/current-user';
import { getCustomerId, readAccessStatus, readLicenceKey, readSubscriptions } from '@/server/db/customer-dashboard';
import { graceEndFor, isEntitled } from '@/server/billing/entitlement-policy';
import type { AccessStatus } from '@/server/db/billing-store';
import { type ServerConfig, serverConfig } from '@/server/config/server-config';

/**
 * Read models for the customer's Pro pages (Access, Install and Billing). Each reads only what its page shows, with
 * the signed-in user's session (customer-dashboard.ts), so RLS guarantees a customer only ever sees their own rows.
 */

/** Shown instead of a page that is not for the login: it has no Pro (or, for Billing, no billing account). */
export interface NoSubscriptionView {
  noSubscription: true;
  /** Whether the login has a billing account: a purchase was made with its confirmed email. */
  customer: boolean;
  /** The login's email, which a purchase must have been made with to show here. */
  accountEmail: string | null;
  /**
   * On Access, a former customer's licence key: it does not expire, and they keep it after their subscription ends.
   * Null otherwise.
   */
  licenceKey: string | null;
}

/** Access (/dashboard/pro), for a customer with Pro: their licence key. */
export interface AccessView {
  noSubscription: false;
  /** Their licence key, which does not expire; null until it is issued. */
  licenceKey: string | null;
}

/** Install (/dashboard/pro/install), for a customer with Pro: setting up the package feed. */
export interface InstallView {
  noSubscription: false;
}

/**
 * Billing (/dashboard/pro/billing), for any customer, with Pro or not: one whose access ended still needs it, to
 * update the payment method that failed or for their invoices.
 */
export interface BillingView {
  noSubscription: false;
  /**
   * The customer's access across all their subscriptions (`active_subscriptions`), or null if they never had any. While
   * every subscription that entitles them is past due, `grace` says when access ends if no payment recovers, and
   * whether that has passed (access is then removed by the next reconcile).
   */
  access: { status: AccessStatus; grace: { endsAt: string; ended: boolean } | null } | null;
  /** The customer's Pro subscriptions that have not ended, from our own records. */
  subscriptions: BillingSubscription[];
}

export interface BillingSubscription {
  id: string;
  /** Paddle's status; never canceled, since ended subscriptions are left out. */
  status: Exclude<SubscriptionStatus, 'canceled'>;
  interval: BillingInterval | null;
  /** When it renews, unless it is scheduled to cancel. */
  renewsAt: string | null;
  /** When a scheduled cancellation takes effect. */
  endsAt: string | null;
}

export async function getAccessView(): Promise<AccessView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  // Read with the access, not after it, saving a round trip: a former customer is shown their key too.
  const [status, licenceKey] = await Promise.all([readAccessStatus(customerId), readLicenceKey(customerId)]);
  if (!status || !isEntitled(status)) return noSubscription(true, licenceKey);

  return { noSubscription: false, licenceKey };
}

export async function getInstallView(): Promise<InstallView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const status = await readAccessStatus(customerId);
  if (!status || !isEntitled(status)) return noSubscription(true);

  return { noSubscription: false };
}

/**
 * `paddle` is the Pro product and prices, by default the server's: read only after the request's session, since the
 * build prerenders the pages that call this until they read the request, and the server's configuration is not read
 * during the build.
 */
export async function getBillingView(paddle?: ServerConfig['paddle']): Promise<BillingView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const [status, subscriptions] = await Promise.all([readAccessStatus(customerId), readSubscriptions(customerId)]);
  const { proProductId, prices } = paddle ?? serverConfig().paddle;

  // The same rule as access itself (entitlement-policy.ts), so the page and the access it describes agree.
  const graceEnd =
    graceEndFor(
      subscriptions.map((row) => ({
        productId: row.product_id,
        status: row.status,
        graceStartedAt: row.grace_started_at ? new Date(row.grace_started_at) : null,
      })),
      proProductId,
    )?.getTime() ?? null;

  return {
    noSubscription: false,
    access: status
      ? {
          status,
          grace:
            status === 'grace' && graceEnd !== null
              ? { endsAt: new Date(graceEnd).toISOString(), ended: graceEnd <= Date.now() }
              : null,
        }
      : null,
    subscriptions: subscriptions
      .filter((row) => row.product_id === proProductId && row.status !== 'canceled')
      .map((row) => billingSubscription(row, prices)),
  };
}

// The login's email is the request's cached user (current-user.ts), which getCustomerId has already read.
async function noSubscription(customer: boolean, licenceKey: string | null = null): Promise<NoSubscriptionView> {
  const user = await getCurrentUser();
  return { noSubscription: true, customer, accountEmail: user?.email ?? null, licenceKey };
}

type SubscriptionRow = Pick<
  Tables<'subscriptions'>,
  | 'subscription_id'
  | 'status'
  | 'price_id'
  | 'scheduled_change_at'
  | 'scheduled_change_action'
  | 'current_period_ends_at'
>;

function billingSubscription(row: SubscriptionRow, prices: OfferPrices): BillingSubscription {
  const endsAt = row.scheduled_change_action === 'cancel' ? row.scheduled_change_at : null;
  const periodEndsAt = row.current_period_ends_at;

  return {
    id: row.subscription_id,
    // Paddle's status, as record_subscription_event stored it; canceled ones are filtered out above.
    status: row.status as BillingSubscription['status'],
    interval: row.price_id === prices.month ? 'month' : row.price_id === prices.year ? 'year' : null,
    renewsAt: endsAt ? null : (periodEndsAt ?? null),
    endsAt,
  };
}
