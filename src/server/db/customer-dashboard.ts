import 'server-only';
import { createUserClient } from '@/server/db/user-client';
import { getCurrentUser } from '@/server/db/current-user';
import { confirmedEmail } from '@/server/db/customer-email';
import type { Access, AccessStatus } from '@/server/db/billing-store';

/**
 * Reads for the customer's dashboard, with the signed-in user's session: RLS lets a customer read only their own
 * customer, access (active_subscriptions), vested entitlements, feed tokens (without their hashes), licence and
 * subscriptions. Each Pro page reads only the rows it shows;
 * its read model (billing/pro-pages.ts) maps them. Rows the session may not read come back empty.
 */

/**
 * The signed-in user's Paddle customer id, or null if they have none. Only a confirmed address identifies a
 * customer; the owner policies enforce the same rule, so this lookup would find nothing otherwise.
 */
export async function getCustomerId(): Promise<string | null> {
  const email = confirmedEmail(await getCurrentUser());
  if (!email) return null;

  const supabase = await createUserClient();
  const { data } = await supabase.from('customers').select('customer_id').eq('email', email).maybeSingle();

  return data?.customer_id ?? null;
}

/** Whether the signed-in user's customer is a test customer (customers.is_test), which is sent no emails. */
export async function isTestCustomer(customerId: string): Promise<boolean> {
  const supabase = await createUserClient();
  const { data } = await supabase.from('customers').select('is_test').eq('customer_id', customerId).maybeSingle();

  return data?.is_test ?? false;
}

/** The customer's access and the progress of their paid time, as last stored (active_subscriptions). */
export interface StoredState {
  access: Access;
  /** Their paid time, while they have access. */
  run: { monthsPaid: number; vestsAt: Date } | null;
}

/** The customer's stored state, or null if it was never recorded. */
export async function readCustomerState(customerId: string): Promise<StoredState | null> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('active_subscriptions')
    .select('access_status,grace_ends_at,months_paid,vests_at')
    .eq('customer_id', customerId)
    .maybeSingle();

  return data
    ? {
        // active_subscriptions' check constraint allows only these.
        access: { status: data.access_status as AccessStatus, graceEndsAt: date(data.grace_ends_at) },
        run: data.vests_at ? { monthsPaid: data.months_paid, vestsAt: new Date(data.vests_at) } : null,
      }
    : null;
}

/** The customer's vested-through date, and the kind of grant that gives it. */
export interface Vested {
  through: Date;
  /** paid_time, annual_term or operator (vested_entitlements.kind). */
  kind: string;
}

/**
 * The customer's vested-through date: the latest of their confirmed grants, operator grants included, as the package
 * feed reads it (vested_through()), with the kind of that grant. Null when nothing is vested.
 */
export async function readVested(customerId: string): Promise<Vested | null> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('vested_entitlements')
    .select('vested_through,kind')
    .eq('customer_id', customerId)
    .eq('status', 'confirmed')
    .order('vested_through', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? { through: new Date(data.vested_through), kind: data.kind } : null;
}

/** One of the customer's feed tokens, as the Access page lists it: never the token, which is not stored. */
export interface FeedTokenRow {
  id: string;
  name: string;
  /** Its first characters, to tell it apart. */
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** The customer's feed tokens that are not revoked, newest first. */
export async function readFeedTokens(customerId: string): Promise<FeedTokenRow[]> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('feed_tokens')
    .select('id,name,prefix,created_at,last_used_at')
    .eq('customer_id', customerId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: new Date(row.created_at),
    lastUsedAt: date(row.last_used_at),
  }));
}

/** The customer's licence key: the newest one. Keys are kept for good, so a former customer still has theirs. */
export async function readLicenceKey(customerId: string): Promise<string | null> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('licences')
    .select('jwt')
    .eq('customer_id', customerId)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.jwt ?? null;
}

/** The customer's subscriptions, as Paddle last reported them. */
export async function readSubscriptions(customerId: string) {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'subscription_id,status,price_id,product_id,scheduled_change_at,scheduled_change_action,current_period_ends_at',
    )
    .eq('customer_id', customerId);

  return data ?? [];
}

function date(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
