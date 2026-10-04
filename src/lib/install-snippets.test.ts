import { describe, expect, it } from 'vitest';
import newestRelease from '../../newest-release.json';
import { snippetProblems } from '../../scripts/install-snippets.mjs';
import {
  ciWorkflow,
  feedCredentials,
  FEED_USERNAME_VARIABLE,
  licenceUserSecret,
  nugetConfig,
} from './install-snippets';

// The snippets are the newest Pro installation guide's (newest-release.json, written by the docs-versions workflow,
// which refuses a guide whose snippets fail snippetProblems).
describe('install snippets', () => {
  it('hold what the pages rely on', () => {
    expect(snippetProblems(newestRelease.proInstallation)).toEqual([]);
  });

  it('point the feed at the environment’s org', () => {
    const config = nugetConfig('tenantry-sandbox');
    expect(config).toContain(
      '<add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-sandbox/index.json" />',
    );
    expect(config).not.toContain('tenantry-org');
  });

  it('set the credentials for the connected GitHub account, or a placeholder', () => {
    expect(feedCredentials('octocat')).toContain(`export ${FEED_USERNAME_VARIABLE}=octocat`);
    expect(feedCredentials(null)).toContain(`export ${FEED_USERNAME_VARIABLE}=your-github-username`);
  });

  it('are the guide’s CI job and user-secrets commands', () => {
    expect(ciWorkflow).toBe(newestRelease.proInstallation.ciWorkflow);
    expect(licenceUserSecret).toBe(newestRelease.proInstallation.licenceUserSecret);
  });
});
