import config from '../../docs-versions.json';

/**
 * The docs versions the site publishes (docs-versions.json, synced by scripts/sync-docs.mjs), newest first. The
 * newest is served at /docs, each older one at /docs/v<version>.
 */
export interface DocsVersion {
  /** The release line, such as `0.4`; also the search tag of its pages. */
  version: string;
  core: string;
  pro: string;
  latest: boolean;
  /** The path its docs are served under. */
  base: string;
}

export const docsVersions: DocsVersion[] = config.versions.map((entry, index) => ({
  ...entry,
  latest: index === 0,
  base: index === 0 ? '/docs' : `/docs/v${entry.version}`,
}));

export const latestDocsVersion = docsVersions[0];

/** The version a docs page belongs to, from its slugs: an older version's pages start with `v<version>`. */
export function docsVersionOf(slugs: string[]): DocsVersion {
  return docsVersions.find((entry) => !entry.latest && slugs[0] === `v${entry.version}`) ?? latestDocsVersion;
}

/**
 * When a page's slugs start with a version the site does not serve under its own path (an older release line it no
 * longer publishes, or the newest, which is served at /docs), the same page's slugs in the newest docs; otherwise
 * null.
 */
export function slugsOutsidePublishedVersions(slugs: string[]): string[] | null {
  return /^v\d+(?:\.\d+)?$/.test(slugs[0] ?? '') && docsVersionOf(slugs).latest ? slugs.slice(1) : null;
}

/** The version of the docs page at a site path (the latest for any other path). */
export function docsVersionOfPath(pathname: string): DocsVersion {
  const match = /^\/docs(?:\/|$)(.*)$/.exec(pathname);
  return match ? docsVersionOf(match[1].split('/')) : latestDocsVersion;
}

/** A page's slugs within its version: the same page in another version has the same ones. */
export function slugsWithinVersion(slugs: string[]): string[] {
  return docsVersionOf(slugs).latest ? slugs : slugs.slice(1);
}

/** The slugs of a page in the given version. */
export function slugsInVersion(slugs: string[], version: DocsVersion): string[] {
  const within = slugsWithinVersion(slugs);
  return version.latest ? within : [`v${version.version}`, ...within];
}

/**
 * Whether the newest docs are of `release` or a later release of the group (`core` or `pro`): copy that describes a
 * feature from the release that adds it follows the release, as the docs do.
 */
export function publishedSince(group: 'core' | 'pro', release: string): boolean {
  const parts = (tag: string) => tag.slice(1).split('.').map(Number);
  const [published, wanted] = [parts(latestDocsVersion[group]), parts(release)];
  const difference = published.map((part, index) => part - wanted[index]).find((part) => part !== 0) ?? 0;
  return difference >= 0;
}
