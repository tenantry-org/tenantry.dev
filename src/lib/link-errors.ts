/**
 * Why connecting GitHub failed, as the Access page explains it (`/dashboard/pro?error=<code>`): recording the link
 * (sync-github-link.ts) and starting it with GitHub (the dashboard's actions.ts). The page has a text for each.
 */
export const LINK_ERROR_CODES = [
  'github-account-linked-elsewhere',
  'github-account-deleted',
  'relink-failed',
  'link-busy',
  'sync-failed',
  'github-link',
  'github-only-sign-in',
] as const;

export type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

export function isLinkErrorCode(value: unknown): value is LinkErrorCode {
  return (LINK_ERROR_CODES as readonly unknown[]).includes(value);
}

/** The Access page, explaining why connecting GitHub failed. */
export function linkErrorPage(code: LinkErrorCode): string {
  return `/dashboard/pro?error=${code}`;
}
