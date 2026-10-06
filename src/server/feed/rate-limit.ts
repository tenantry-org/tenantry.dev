import 'server-only';
import { checkRateLimit } from '@vercel/firewall';

/**
 * The package feed's rate limit: every feed request is counted against the client's IP address by a Vercel Firewall
 * rule whose rate limit ID is FEED_RATE_LIMIT_ID. The rule (its window, limit and action) is set in the Vercel
 * dashboard; LAUNCH-SETUP.md, Package feed, says how. The check runs before the feed looks a token up, so guessing
 * tokens is limited as well as restoring with a shared one.
 *
 * It fails open: a deployment without the rule, `next dev`, or a firewall that cannot be reached lets the request
 * through and logs a warning, since refusing every restore is worse than an unlimited minute.
 */

export const FEED_RATE_LIMIT_ID = 'package-feed';
/** How long a restore waits for the firewall's answer before going ahead without it. */
const CHECK_TIMEOUT_MS = 1000;

export async function feedRateLimited(request: Request, check = checkRateLimit): Promise<boolean> {
  try {
    const { rateLimited, error } = await check(FEED_RATE_LIMIT_ID, {
      // The check sends the headers it is given on to the firewall: only the host and the client's address, so the
      // feed token and the publish credentials stay out of it.
      headers: checkHeaders(request.headers),
      timeout: CHECK_TIMEOUT_MS,
    });
    if (error === 'not-found') {
      console.warn(
        `Package feed: no Vercel Firewall rule has the rate limit ID ${FEED_RATE_LIMIT_ID}, so nothing is limited.`,
      );
    }
    return rateLimited;
  } catch (error) {
    console.warn('Package feed: the rate limit could not be checked, so the request goes ahead:', error);
    return false;
  }
}

function checkHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of ['host', 'x-real-ip', 'x-forwarded-for']) {
    const value = headers.get(name);
    if (value !== null) kept[name] = value;
  }
  return kept;
}
