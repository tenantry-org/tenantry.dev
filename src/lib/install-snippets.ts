import newestRelease from '../../newest-release.json';
import { GUIDE_FEED, LOGIN_PLACEHOLDER } from '../../scripts/install-snippets.mjs';

/**
 * The setup snippets the Pro access page shows: those of the installation guide (docs/installation.md) of the newest
 * Tenantry Pro release the site publishes, which the docs-versions workflow copies into newest-release.json
 * (scripts/install-snippets.mjs), with the environment's GitHub org in place of `tenantry-org`. So the portal and the
 * docs never give different instructions, and a release that changes the guide changes the portal with it. The
 * workflow refuses a guide without the names the pages' text gives (snippetProblems), before committing anything.
 */
const { proInstallation } = newestRelease;

export {
  FEED_TOKEN_VARIABLE,
  FEED_USERNAME_VARIABLE,
  LICENCE_CONFIG_KEY,
  LICENCE_ENV_VARIABLE,
} from '../../scripts/install-snippets.mjs';

/** Creates a classic token with only `read:packages` selected; GitHub Packages accepts no other kind. */
export const CREATE_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=read:packages&description=Tenantry%20Pro%20packages';

export function nugetConfig(githubOrg: string): string {
  return proInstallation.nugetConfig.replace(GUIDE_FEED, `https://nuget.pkg.github.com/${githubOrg}/`);
}

/** Setting the feed credentials on a developer machine (macOS or Linux). */
export function feedCredentials(githubLogin: string | null): string {
  return githubLogin
    ? proInstallation.feedCredentials.replace(LOGIN_PLACEHOLDER, githubLogin)
    : proInstallation.feedCredentials;
}

export const licenceUserSecret = proInstallation.licenceUserSecret;

/** A GitHub Actions job restoring from the feed and running the tests with the licence key. */
export const ciWorkflow = proInstallation.ciWorkflow;
