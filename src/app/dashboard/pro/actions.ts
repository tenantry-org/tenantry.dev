'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerId, isTestCustomer } from '@/server/db/customer-dashboard';
import { getCurrentUser } from '@/server/db/current-user';
import { confirmedEmail } from '@/server/db/customer-email';
import { FEED_TOKEN_LIMIT, readEntitlement } from '@/server/billing/pro-pages';
import { createFeedToken as recordFeedToken, revokeFeedToken as revokeRecordedToken } from '@/server/feed/feed-tokens';
import { sendEmail } from '@/server/integrations/email/send';
import { feedTokenCreatedEmail } from '@/server/integrations/email/templates';
import { serverConfig } from '@/server/config/server-config';

/**
 * The Pro access page's feed token actions. Each acts only for the signed-in customer: the customer comes from the
 * session (customer-dashboard.ts: getCustomerId, by the login's confirmed email), never from the browser, and the
 * database functions they call take that customer's id, so a token id from the browser can only ever name one of
 * theirs. Next.js accepts a server action only as a POST whose Origin is the site's own host, which is the CSRF
 * protection the other dashboard actions rely on too. The token itself is returned once, to the browser that created
 * it, and is never logged or stored: only its hash is (feed-tokens.ts).
 */

type Result<T> = T | { error: string };

/** How long a feed token's name may be (feed_tokens' check constraint). */
const NAME_MAX = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ACCOUNT = 'No Tenantry Pro billing account is linked to this login';
const FAILED = 'Something went wrong. Try again in a moment.';

/** Creates a feed token named `name` for the signed-in customer, and returns it: the only time it is shown. */
export async function createFeedToken(name: unknown): Promise<Result<{ token: string; prefix: string; name: string }>> {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return { error: 'Give the token a name, such as the machine or CI system that will use it.' };
  if (trimmed.length > NAME_MAX) return { error: `A token's name can be at most ${NAME_MAX} characters.` };

  try {
    const customerId = await getCustomerId();
    if (!customerId) return { error: NO_ACCOUNT };

    const entitlement = await readEntitlement(customerId);
    if (!entitlement.canRestore) {
      return {
        error:
          'Your subscription has ended and no releases are vested, so the package feed serves you nothing and a feed ' +
          'token would restore nothing. Subscribe again to restore Tenantry Pro.',
      };
    }

    // Every read that can fail runs before the token is stored, so a failure never leaves a live token that was not
    // shown. A test customer, such as the release check's, is sent no emails.
    const email = confirmedEmail(await getCurrentUser());
    const notify = email !== null && !(await isTestCustomer(customerId));

    let created: Awaited<ReturnType<typeof recordFeedToken>>;
    try {
      created = await recordFeedToken(customerId, trimmed);
    } catch (error) {
      // create_feed_token refuses an eleventh live token with a check violation; the name is checked above.
      if (isCheckViolation(error)) {
        return {
          error: `You have ${FEED_TOKEN_LIMIT} feed tokens, the most you can hold at once. Revoke one you no longer use to create another.`,
        };
      }
      throw error;
    }

    console.info(`Feed token ${created.id} created for customer ${customerId}.`);
    if (notify) {
      // Never throws (send.ts). Tells the customer, so a token they did not create is noticed.
      await sendEmail(feedTokenCreatedEmail(email, { name: trimmed, prefix: created.prefix }, serverConfig().siteUrl));
    }

    revalidatePath('/dashboard/pro', 'layout');
    return { token: created.token, prefix: created.prefix, name: trimmed };
  } catch (error) {
    console.error('Creating a feed token failed:', error);
    return { error: FAILED };
  }
}

/** Revokes one of the signed-in customer's feed tokens at once; their others keep working. */
export async function revokeFeedToken(tokenId: unknown): Promise<Result<{ revoked: true }>> {
  if (typeof tokenId !== 'string' || !UUID.test(tokenId)) return { error: 'Feed token not found.' };

  try {
    const customerId = await getCustomerId();
    if (!customerId) return { error: NO_ACCOUNT };

    if (!(await revokeRecordedToken(customerId, tokenId))) {
      return { error: 'Feed token not found. It may have been revoked already.' };
    }

    console.info(`Feed token ${tokenId} revoked by customer ${customerId}.`);
    revalidatePath('/dashboard/pro', 'layout');
    return { revoked: true };
  } catch (error) {
    console.error('Revoking a feed token failed:', error);
    return { error: FAILED };
  }
}

function isCheckViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
}
