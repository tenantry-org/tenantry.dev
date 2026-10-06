/**
 * The vested releases, as the site, the dashboard and the emails describe them. A patch release takes the release
 * date of its x.y.0 release, so it is vested with it. Each place that uses this links to the rules (VESTING_RULES)
 * rather than restating them.
 */
export const VESTED_RELEASES = 'the releases published up to your vested-through date, and their later patch releases';

/** The rules for vesting: section 2 of the EULA. */
export const VESTING_RULES = '/legal/eula#vesting';
