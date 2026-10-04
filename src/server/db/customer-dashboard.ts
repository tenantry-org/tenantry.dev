import 'server-only';
import { createUserClient } from '@/server/db/user-client';
import { getCurrentUser } from '@/server/db/current-user';
import { confirmedEmail } from '@/server/db/customer-email';
import type { AccessStatus, CustomerAccessRecord, GithubState } from '@/server/db/billing-store';

/**
 * Reads for the customer's dashboard, with the signed-in user's session: RLS lets a customer read only their own
 * customer, access (active_subscriptions), licence, GitHub link and subscriptions. Each Pro page reads only the rows it shows;
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

/** The customer's access across their subscriptions, and their GitHub org membership. */
export async function readCustomerAccess(customerId: string): Promise<CustomerAccessRecord | null> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('active_subscriptions')
    .select('access_status,github_state,github_invited_at')
    .eq('customer_id', customerId)
    .maybeSingle();

  return data
    ? {
        // active_subscriptions' check constraints allow only these.
        status: data.access_status as AccessStatus,
        githubState: data.github_state as GithubState,
        githubInvitedAt: data.github_invited_at ? new Date(data.github_invited_at) : null,
      }
    : null;
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

/** The login of the GitHub account the customer connected. */
export async function readGithubLogin(customerId: string): Promise<string | null> {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('github_links')
    .select('github_login')
    .eq('customer_id', customerId)
    .maybeSingle();

  return data?.github_login ?? null;
}

/** The customer's subscriptions, as Paddle last reported them. */
export async function readSubscriptions(customerId: string) {
  const supabase = await createUserClient();
  const { data } = await supabase
    .from('subscriptions')
    .select(
      'subscription_id,status,price_id,product_id,scheduled_change_at,scheduled_change_action,current_period_ends_at,grace_started_at',
    )
    .eq('customer_id', customerId);

  return data ?? [];
}
