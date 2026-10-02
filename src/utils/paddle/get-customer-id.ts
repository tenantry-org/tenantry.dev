import 'server-only';
import { createUserClient } from '@/utils/supabase/user-client';
import { confirmedEmail } from '@/utils/customers/email';

/**
 * The signed-in user's Paddle customer id, or '' if they have none. Only a confirmed address identifies a
 * customer; the owner policies enforce the same rule, so this lookup would find nothing otherwise.
 */
export async function getCustomerId() {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = confirmedEmail(user);
  if (!email) return '';

  const { data } = await supabase.from('customers').select('customer_id').eq('email', email).maybeSingle();

  return (data?.customer_id as string | undefined) ?? '';
}
