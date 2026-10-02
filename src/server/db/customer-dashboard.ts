import 'server-only';
import { createUserClient } from '@/server/db/user-client';
import { confirmedEmail } from '@/server/db/customer-email';

/**
 * Reads for the customer's dashboard, with the signed-in user's session: RLS lets a customer read only their own
 * customer, access, licence, GitHub link, entitlements and subscriptions. The Pro pages' read model
 * (billing/pro-access.ts) maps the rows.
 */

/**
 * The signed-in user's Paddle customer id, or '' if they have none. Only a confirmed address identifies a
 * customer; the owner policies enforce the same rule, so this lookup would find nothing otherwise.
 */
export async function getCustomerId(): Promise<string> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = confirmedEmail(user);
  if (!email) return '';

  const { data } = await supabase.from('customers').select('customer_id').eq('email', email).maybeSingle();

  return data?.customer_id ?? '';
}

/** The customer's rows the Pro pages show. Rows the session may not read come back empty. */
export async function readDashboardRows(customerId: string) {
  const supabase = await createUserClient();

  const [{ data: access }, { data: licence }, { data: link }, { data: entitlements }, { data: subscriptions }] =
    await Promise.all([
      supabase
        .from('customer_access')
        .select('status,github_state,github_invited_at')
        .eq('customer_id', customerId)
        .maybeSingle(),
      supabase
        .from('licences')
        .select('jwt')
        .eq('customer_id', customerId)
        .eq('revoked', false)
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('github_links').select('github_login').eq('customer_id', customerId).maybeSingle(),
      supabase
        .from('entitlements')
        .select('subscription_id,status,current_period_ends_at,grace_started_at')
        .eq('customer_id', customerId),
      supabase
        .from('subscriptions')
        .select('subscription_id,subscription_status,price_id,product_id,scheduled_change,scheduled_change_action')
        .eq('customer_id', customerId),
    ]);

  return { access, licence, link, entitlements: entitlements ?? [], subscriptions: subscriptions ?? [] };
}

export type DashboardRows = Awaited<ReturnType<typeof readDashboardRows>>;
