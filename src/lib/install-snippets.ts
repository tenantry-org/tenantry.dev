import newestRelease from '../../newest-release.json';

/**
 * The setup snippets the Pro access page shows: those of the installation guide (docs/installation.md) of the newest
 * Tenantry Pro release the site publishes, which the docs-versions workflow copies into newest-release.json
 * (scripts/newest-release.mjs), with the environment's GitHub org in place of `tenantry-org`. So the portal and the
 * docs never give different instructions, and a release that changes the guide changes the portal with it. The
 * names below are the ones the pages' text gives; install-snippets.test.ts checks the guide still uses them.
 */
const { proInstallation } = newestRelease;

/** Environment variables the `nuget.config` reads the feed credentials from. */
export const FEED_USERNAME_VARIABLE = 'TENANTRY_GITHUB_USERNAME';
export const FEED_TOKEN_VARIABLE = 'TENANTRY_GITHUB_PAT';

/** Creates a classic token with only `read:packages` selected; GitHub Packages accepts no other kind. */
export const CREATE_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=read:packages&description=Tenantry%20Pro%20packages';

/** Where Tenantry.Pro reads the licence key from: the configuration key, and its environment-variable form. */
export const LICENCE_CONFIG_KEY = 'Tenantry:License';
export const LICENCE_ENV_VARIABLE = 'Tenantry__License';

// The feed in the guide's nuget.config.
const GUIDE_FEED = 'https://nuget.pkg.github.com/tenantry-org/';

export function nugetConfig(githubOrg: string): string {
  return proInstallation.nugetConfig.replace(GUIDE_FEED, `https://nuget.pkg.github.com/${githubOrg}/`);
}

/** Setting the feed credentials on a developer machine (macOS or Linux). */
export function feedCredentials(githubLogin: string | null): string {
  return githubLogin
    ? proInstallation.feedCredentials.replace('your-github-username', githubLogin)
    : proInstallation.feedCredentials;
}

export const licenceUserSecret = proInstallation.licenceUserSecret;

/** A GitHub Actions job restoring from the feed and running the tests with the licence key. */
export const ciWorkflow = proInstallation.ciWorkflow;
