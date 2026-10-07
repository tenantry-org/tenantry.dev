import { describe, expect, it } from 'vitest';
import {
  ciWorkflow,
  dockerBuild,
  dockerRestore,
  FEED_SOURCE_KEY,
  FEED_TOKEN_VARIABLE,
  feedTokenPowerShell,
  feedTokenShell,
  feedUrl,
  LICENCE_ENV_VARIABLE,
  nugetConfig,
} from './install-snippets';

describe('install snippets', () => {
  it('point the package source at this deployment’s feed', () => {
    expect(feedUrl('https://sandbox.tenantry.dev')).toBe('https://sandbox.tenantry.dev/feed/v3/index.json');
    const config = nugetConfig('https://sandbox.tenantry.dev');
    expect(config).toContain(
      `<add key="${FEED_SOURCE_KEY}" value="https://sandbox.tenantry.dev/feed/v3/index.json" protocolVersion="3" />`,
    );
    expect(config).not.toContain('nuget.pkg.github.com');
  });

  it('name the source with a key a shell can set its credentials variable for', () => {
    // NuGet reads the source's credentials from NuGetPackageSourceCredentials_<key>; a shell variable name is letters,
    // digits and underscores.
    expect(`NuGetPackageSourceCredentials_${FEED_SOURCE_KEY}`).toMatch(/^[A-Za-z_]\w*$/);
    expect(nugetConfig('https://tenantry.dev')).toMatch(
      new RegExp(`<${FEED_SOURCE_KEY}>\\s*<add key="Username"[^]*</${FEED_SOURCE_KEY}>`),
    );
  });

  it('send only Tenantry Pro’s packages to the feed, and nuget.org nothing else', () => {
    const sources = [...nugetConfig('https://tenantry.dev').matchAll(/<add key="([^"]+)" value="https/g)].map(
      (match) => match[1],
    );
    expect(sources).toEqual(['nuget.org', FEED_SOURCE_KEY]);
    expect(nugetConfig('https://tenantry.dev')).toMatch(
      new RegExp(
        `<packageSource key="${FEED_SOURCE_KEY}">\\s*<package pattern="Tenantry.Pro" />\\s*<package pattern="Tenantry.Pro.\\*" />\\s*</packageSource>`,
      ),
    );
  });

  it('read the feed token from the environment, never holding one', () => {
    expect(nugetConfig('https://tenantry.dev')).toContain(
      `<add key="ClearTextPassword" value="%${FEED_TOKEN_VARIABLE}%" />`,
    );
    for (const snippet of [nugetConfig('https://tenantry.dev'), ciWorkflow, dockerRestore, dockerBuild]) {
      expect(snippet).not.toMatch(/tpf_[A-Za-z0-9_-]{20,}/);
    }
    expect(feedTokenShell).toBe(`export ${FEED_TOKEN_VARIABLE}=tpf_your_feed_token`);
    expect(feedTokenPowerShell).toContain(`'${FEED_TOKEN_VARIABLE}', 'tpf_your_feed_token', 'User'`);
  });

  it('use the action versions the site’s own workflows use', () => {
    expect(ciWorkflow).toContain('uses: actions/checkout@v7');
    expect(ciWorkflow).toContain('uses: actions/setup-dotnet@v6');
  });

  it('take the token from CI secrets and Docker build secrets, and restore in locked mode', () => {
    expect(ciWorkflow).toContain(`${FEED_TOKEN_VARIABLE}: \${{ secrets.${FEED_TOKEN_VARIABLE} }}`);
    expect(ciWorkflow).toContain(`${LICENCE_ENV_VARIABLE}: \${{ secrets.TENANTRY_LICENSE }}`);
    expect(ciWorkflow).toContain('dotnet restore --locked-mode');
    expect(dockerRestore).toContain(`--mount=type=secret,id=tenantry_feed_token,env=${FEED_TOKEN_VARIABLE}`);
    expect(dockerRestore).toContain('--locked-mode');
    expect(dockerRestore).toContain('COPY nuget.config Directory.*.props ./');
    expect(dockerBuild).toContain(`--secret id=tenantry_feed_token,env=${FEED_TOKEN_VARIABLE}`);
  });
});
