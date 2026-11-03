import newestRelease from '../../newest-release.json';

/**
 * The .NET versions Tenantry supports, as the site states them: those the newest release's packages target
 * (newest-release.json, from Tenantry Core's nuspec), with .NET 8 and 9 supported until 1.0 (Core's compatibility
 * guide). A release that adds or drops a target framework changes it.
 */
const LEGACY = ['8', '9'];

/**
 * 1.0 comes no earlier than this date, a floor rather than a target, and drops .NET 8 and 9, so it is also the earliest
 * their support can end. The hero, the Pro page, the compare page and the checkout state it, as Core's and Pro's
 * compatibility guides do: a change to it changes them in the same release.
 */
export const V1_NOT_BEFORE = '10 May 2027';
export const LEGACY_SUPPORT_ENDS = V1_NOT_BEFORE;

function list(versions: string[]): string {
  return versions.length > 1 ? `${versions.slice(0, -1).join(', ')} and ${versions.at(-1)}` : versions.join('');
}

/** `.NET 10, and .NET 8 and 9 until 10 May 2027`, for the given target frameworks' major versions. */
export function dotnetSupport(versions: string[]): string {
  const current = versions.filter((version) => !LEGACY.includes(version));
  const legacy = versions.filter((version) => LEGACY.includes(version));
  const supported = `.NET ${list(current)}`;
  return legacy.length > 0 ? `${supported}, and .NET ${list(legacy)} until ${LEGACY_SUPPORT_ENDS}` : supported;
}

export const DOTNET_SUPPORT = dotnetSupport(newestRelease.dotnet);
