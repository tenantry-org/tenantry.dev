/**
 * Tenantry Pro's versions as the package feed accepts them: a release, major.minor.patch, or a release candidate,
 * major.minor.patch-rc.N with N from 1, as Pro's release process tags them (RELEASE-CHECKLIST.md in tenantry-pro). No
 * leading zeros, no other prerelease label and no build metadata, so each version has one spelling, already in the
 * lower case and normalised form NuGet's flat container and registration resources use.
 */

export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  /** The release candidate's number, or null for a release. */
  rc: number | null;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;
const MAX_PART = 2_147_483_647;

/** The version's parts, or null if the feed does not accept it. */
export function parseVersion(version: string): ReleaseVersion | null {
  const match = VERSION.exec(version);
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
  const rc = match[4] === undefined ? null : Number(match[4]);
  // pro_releases stores each part as an integer.
  if ([major, minor, patch, rc ?? 0].some((part) => part > MAX_PART)) return null;
  return { major, minor, patch, rc };
}

/**
 * SemVer's order: by major, minor and patch, then a release candidate before its release, and candidates by number.
 * Negative if `a` comes first, positive if `b` does, 0 for the same version.
 */
export function compareVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  const byNumbers = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (byNumbers !== 0 || a.rc === b.rc) return byNumbers;
  if (a.rc === null) return 1;
  if (b.rc === null) return -1;
  return a.rc - b.rc;
}
