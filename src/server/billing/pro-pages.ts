import 'server-only';
import type { SubscriptionStatus } from '@paddle/paddle-node-sdk';
import type { Tables } from '@/lib/supabase/database.types';
import type { BillingInterval, OfferPrices } from '@/lib/public-config';
import { getCurrentUser } from '@/server/db/current-user';
import {
  getCustomerId,
  readCustomerState,
  readFeedTokens,
  readLicenceKey,
  readSubscriptions,
  readVested,
} from '@/server/db/customer-dashboard';
import { canRestore, currentAccess } from '@/server/billing/entitlement-policy';
import type { AccessStatus } from '@/server/db/billing-store';
import { type ServerConfig, serverConfig } from '@/server/config/server-config';

/**
 * Read models for the customer's Pro pages (Access, Install and Billing). Each reads only what its page shows, with
 * the signed-in user's session (customer-dashboard.ts), so RLS guarantees a customer only ever sees their own rows.
 * What a customer may access is decided by entitlement-policy.ts from what is stored, as the package feed decides it,
 * so the pages and the feed agree.
 */

/** The most feed tokens a customer holds at once (create_feed_token refuses an eleventh). */
export const FEED_TOKEN_LIMIT = 10;

/** Shown instead of a page that is not for the login: it has no billing account, or, on Install, nothing to restore. */
export interface NoSubscriptionView {
  noSubscription: true;
  /** Whether the login has a billing account: a purchase was made with its confirmed email. */
  customer: boolean;
  /** The login's email, which a purchase must have been made with to show here. */
  accountEmail: string | null;
}

/**
 * What the customer may access now and owns for good, as the Access and Billing pages both show it. Dates are ISO
 * strings, since the view reaches client components.
 */
export interface EntitlementView {
  /** Access now (entitlement-policy.ts: currentAccess): a grace period that has ended is lapsed. */
  access: AccessStatus;
  /** While in grace: when access ends unless a payment recovers. */
  graceEndsAt: string | null;
  /** Whether the package feed serves them anything: access, or vested releases (entitlement-policy.ts: canRestore). */
  canRestore: boolean;
  /** The vested-through date: every release published on or before it is vested. Null when nothing is vested. */
  vestedThrough: string | null;
  /**
   * Their paid time, while they have access: its whole months (the time the money kept pays for, across every
   * subscription, served or paid ahead), when it reaches 12 months, and whether it has by now.
   */
  paidTime: { monthsPaid: number; vestsAt: string; reached: boolean } | null;
  /**
   * Whether, while they have access, the vested-through date is the end of an annual term not over yet: its payment
   * vested the releases published up to then, as they are published.
   */
  annualTerm: boolean;
}

/** One of the customer's feed tokens, as the Access page lists it. */
export interface FeedTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Access (/dashboard/pro), for any customer: their entitlement, feed tokens and licence key. */
export interface AccessView {
  noSubscription: false;
  entitlement: EntitlementView;
  /** Their feed tokens that are not revoked, newest first. */
  tokens: FeedTokenView[];
  /** Their licence key, which does not expire and which they keep after a lapse; null until it is issued. */
  licenceKey: string | null;
}

/** Install (/dashboard/pro/install), for a customer the package feed serves: restoring from it. */
export interface InstallView {
  noSubscription: false;
  entitlement: EntitlementView;
}

/**
 * Billing (/dashboard/pro/billing), for any customer, with Pro or not: one whose access ended still needs it, to
 * update the payment method that failed or for their invoices.
 */
export interface BillingView {
  noSubscription: false;
  entitlement: EntitlementView;
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

/**
 * The customer's entitlement as of `now`, from what is stored: the one read that the Access and Billing pages, and the
 * feed token actions, take it from.
 */
export async function readEntitlement(customerId: string, now: Date = new Date()): Promise<EntitlementView> {
  const [state, vested] = await Promise.all([readCustomerState(customerId), readVested(customerId)]);
  const vestedThrough = vested?.through ?? null;
  const access = currentAccess(state?.access ?? null, now);
  const entitled = access.status !== 'lapsed';

  return {
    access: access.status,
    graceEndsAt: iso(access.graceEndsAt),
    canRestore: canRestore({ accessStatus: access.status, vestedThrough }),
    vestedThrough: iso(vestedThrough),
    // Progress is shown only while the customer has access; the paid time itself is kept through a lapse.
    paidTime:
      entitled && state?.run
        ? {
            monthsPaid: state.run.monthsPaid,
            vestsAt: state.run.vestsAt.toISOString(),
            // Reached only once something is vested: a stored estimate can pass while a failed renewal is in grace.
            reached: vestedThrough !== null && state.run.vestsAt.getTime() <= now.getTime(),
          }
        : null,
    annualTerm: entitled && vested?.kind === 'annual_term' && vested.through.getTime() > now.getTime(),
  };
}

export async function getAccessView(): Promise<AccessView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const [entitlement, tokens, licenceKey] = await Promise.all([
    readEntitlement(customerId),
    readFeedTokens(customerId),
    readLicenceKey(customerId),
  ]);

  return {
    noSubscription: false,
    entitlement,
    tokens: tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: iso(token.lastUsedAt),
    })),
    licenceKey,
  };
}

export async function getInstallView(): Promise<InstallView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const entitlement = await readEntitlement(customerId);
  if (!entitlement.canRestore) return noSubscription(true);

  return { noSubscription: false, entitlement };
}

/**
 * `paddle` is the Pro product and prices, by default the server's: read only after the request's session, since the
 * build prerenders the pages that call this until they read the request, and the server's configuration is not read
 * during the build.
 */
export async function getBillingView(paddle?: ServerConfig['paddle']): Promise<BillingView | NoSubscriptionView> {
  const customerId = await getCustomerId();
  if (!customerId) return noSubscription(false);

  const [entitlement, subscriptions] = await Promise.all([readEntitlement(customerId), readSubscriptions(customerId)]);
  const { proProductId, prices } = paddle ?? serverConfig().paddle;

  return {
    noSubscription: false,
    entitlement,
    subscriptions: subscriptions
      .filter((row) => row.product_id === proProductId && row.status !== 'canceled')
      .map((row) => billingSubscription(row, prices)),
  };
}

// The login's email is the request's cached user (current-user.ts), which getCustomerId has already read.
async function noSubscription(customer: boolean): Promise<NoSubscriptionView> {
  const user = await getCurrentUser();
  return { noSubscription: true, customer, accountEmail: user?.email ?? null };
}

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
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
