/**
 * A date as the Pro pages show it, such as 1 January 2028, in UTC: the same on the server and in every browser, so a
 * client component renders it as the server did, and as the dates the package feed compares.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
