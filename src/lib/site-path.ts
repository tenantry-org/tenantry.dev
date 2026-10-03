// Any origin will do: only paths are accepted, and one that resolves to another origin is not on the site.
const ORIGIN = 'https://site.invalid';

/**
 * A `next` page to continue to after signing in, when it is a path on this site; otherwise null. Anyone can write a
 * link, so a `next` that leaves the site (`//evil.example`, `@evil.example`, a full URL) or is no URL at all (`//`) is
 * refused.
 */
export function sitePath(next: string | null | undefined): string | null {
  const page = next?.startsWith('/') ? URL.parse(next, ORIGIN) : null;
  return page?.origin === ORIGIN ? `${page.pathname}${page.search}${page.hash}` : null;
}
