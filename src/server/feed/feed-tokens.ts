import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { type FeedDeps, defaultFeedDeps } from '@/server/feed/deps';

/**
 * Feed tokens: the per-customer credentials NuGet sends to the feed (as the basic-auth password). A token is 32 random
 * bytes, base64url, after a `tpf_` prefix that makes a leaked one recognisable; only its SHA-256 is stored, so it is
 * shown once, when created. A customer holds up to 10 at once, named, uses them as they choose, and revokes each on
 * its own. The licence key is never a feed credential: it ships inside customers' applications.
 */

const TOKEN_PREFIX = 'tpf_';
/** How much of a token is kept to tell it apart on the dashboard: the prefix and 4 more characters. */
const SHOWN_LENGTH = TOKEN_PREFIX.length + 4;

const TOKEN_SHAPE = /^tpf_[A-Za-z0-9_-]{43}$/;

/**
 * Whether a credential has the shape every feed token has. The feed asks the database only about one that does, so a
 * request with a made-up or mistyped credential costs no query.
 */
export function isFeedTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Creates a token for the customer, records its hash, and returns the token: the only time it is available. */
export async function createFeedToken(
  customerId: string,
  name: string,
  deps: FeedDeps = defaultFeedDeps,
): Promise<{ id: string; token: string; prefix: string }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const prefix = token.slice(0, SHOWN_LENGTH);
  const id = await deps.store.createFeedTokenRecord({ customerId, name, tokenHash: hashFeedToken(token), prefix });

  return { id, token, prefix };
}

/** Revokes one of the customer's tokens at once; the others keep working. False if it was not theirs or not live. */
export function revokeFeedToken(customerId: string, tokenId: string, deps: FeedDeps = defaultFeedDeps) {
  return deps.store.revokeFeedTokenRecord(customerId, tokenId);
}

/**
 * The feed token in a request's basic authentication: the password, as NuGet sends a nuget.config's ClearTextPassword
 * (any username), or the username when the password is empty. Null without basic authentication.
 */
export function feedTokenFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header ? /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header) : null;
  if (!match) return null;

  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const username = separator < 0 ? decoded : decoded.slice(0, separator);
  const password = separator < 0 ? '' : decoded.slice(separator + 1);

  return password || username || null;
}
