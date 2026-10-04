import { describe, expect, it } from 'vitest';
import {
  ciWorkflow,
  feedCredentials,
  FEED_TOKEN_VARIABLE,
  FEED_USERNAME_VARIABLE,
  LICENCE_CONFIG_KEY,
  LICENCE_ENV_VARIABLE,
  licenceUserSecret,
  nugetConfig,
} from './install-snippets';

// The snippets are the newest Pro installation guide's (newest-release.json, written by the docs-versions workflow).
// The Pro access and install pages' text names the feed, the packages, the variables and the configuration key, and
// these tests fail when the guide no longer matches that text: then the pages' text needs changing too.
describe('install snippets', () => {
  it('point the feed at the environment’s org', () => {
    const config = nugetConfig('tenantry-sandbox');
    expect(config).toContain(
      '<add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-sandbox/index.json" />',
    );
    expect(config).not.toContain('tenantry-org');
  });

  it('send Tenantry.Pro and Tenantry.Pro.* to the feed, with the credentials from the variables the pages name', () => {
    const config = nugetConfig('tenantry-org');
    expect(config).toContain('<package pattern="Tenantry.Pro" />');
    expect(config).toContain('<package pattern="Tenantry.Pro.*" />');
    expect(config).toContain(`%${FEED_USERNAME_VARIABLE}%`);
    expect(config).toContain(`%${FEED_TOKEN_VARIABLE}%`);
  });

  it('set the credentials for the connected GitHub account, or a placeholder', () => {
    expect(feedCredentials('octocat')).toContain(`export ${FEED_USERNAME_VARIABLE}=octocat`);
    expect(feedCredentials(null)).toContain(`export ${FEED_USERNAME_VARIABLE}=your-github-username`);
    expect(feedCredentials(null)).toContain(`export ${FEED_TOKEN_VARIABLE}=`);
  });

  it('give CI the feed credentials and the licence key under the names the pages give', () => {
    for (const name of [FEED_USERNAME_VARIABLE, FEED_TOKEN_VARIABLE, LICENCE_ENV_VARIABLE]) {
      expect(ciWorkflow).toContain(`${name}: `);
    }
    expect(licenceUserSecret).toContain(`dotnet user-secrets set "${LICENCE_CONFIG_KEY}"`);
  });
});
