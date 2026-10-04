import newestRelease from '../../newest-release.json';

/**
 * The .NET versions Tenantry supports, as the site states them: those the newest release's packages target
 * (newest-release.json, from Tenantry Core's nuspec), with .NET 8 and 9 supported until a year after Microsoft's
 * support ends (Core's compatibility guide). A release that adds or drops a target framework changes it.
 */
const LEGACY = ['8', '9'];
export const LEGACY_SUPPORT_ENDS = '10 November 2027';

function list(versions: string[]): string {
  return versions.length > 1 ? `${versions.slice(0, -1).join(', ')} and ${versions.at(-1)}` : versions.join('');
}

/** `.NET 10, and .NET 8 and 9 until 10 November 2027`, for the given target frameworks' major versions. */
export function dotnetSupport(versions: string[]): string {
  const current = versions.filter((version) => !LEGACY.includes(version));
  const legacy = versions.filter((version) => LEGACY.includes(version));
  const supported = `.NET ${list(current)}`;
  return legacy.length > 0 ? `${supported}, and .NET ${list(legacy)} until ${LEGACY_SUPPORT_ENDS}` : supported;
}

export const DOTNET_SUPPORT = dotnetSupport(newestRelease.dotnet);
