/**
 * The setup snippets the Pro access page shows. They match Tenantry.Pro's installation guide
 * (docs/installation.md in tenantry-pro), with the environment's GitHub org in place of `tenantry-org`, so
 * the portal and the docs never give different instructions. install-snippets.test.ts compares them.
 */

/** Environment variables the `nuget.config` reads the feed credentials from. */
export const FEED_USERNAME_VARIABLE = 'TENANTRY_GITHUB_USERNAME';
export const FEED_TOKEN_VARIABLE = 'TENANTRY_GITHUB_PAT';

/** Creates a classic token with only `read:packages` selected; GitHub Packages accepts no other kind. */
export const CREATE_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=read:packages&description=Tenantry%20Pro%20packages';

/** Where Tenantry.Pro reads the licence key from: the configuration key, and its environment-variable form. */
export const LICENCE_CONFIG_KEY = 'Tenantry:License';
export const LICENCE_ENV_VARIABLE = 'Tenantry__License';

export function nugetConfig(githubOrg: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="tenantry-pro" value="https://nuget.pkg.github.com/${githubOrg}/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
    <packageSource key="tenantry-pro">
      <package pattern="Tenantry.Pro" />
      <package pattern="Tenantry.Pro.*" />
    </packageSource>
  </packageSourceMapping>
  <packageSourceCredentials>
    <tenantry-pro>
      <add key="Username" value="%${FEED_USERNAME_VARIABLE}%" />
      <add key="ClearTextPassword" value="%${FEED_TOKEN_VARIABLE}%" />
    </tenantry-pro>
  </packageSourceCredentials>
</configuration>
`;
}

/** Setting the feed credentials on a developer machine (macOS or Linux). */
export function feedCredentials(githubLogin: string | null): string {
  return `export ${FEED_USERNAME_VARIABLE}=${githubLogin ?? 'your-github-username'}
export ${FEED_TOKEN_VARIABLE}=ghp_your_token`;
}

export const licenceUserSecret = `dotnet user-secrets init
dotnet user-secrets set "${LICENCE_CONFIG_KEY}" "<your licence key>"`;

/** A GitHub Actions job restoring from the feed and running the tests with the licence key. */
export const ciWorkflow = `jobs:
  build:
    runs-on: ubuntu-latest
    env:
      ${FEED_USERNAME_VARIABLE}: \${{ vars.${FEED_USERNAME_VARIABLE} }}
      ${FEED_TOKEN_VARIABLE}: \${{ secrets.${FEED_TOKEN_VARIABLE} }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - run: dotnet restore
      - run: dotnet build --no-restore
      - run: dotnet test --no-build
        env:
          ${LICENCE_ENV_VARIABLE}: \${{ secrets.TENANTRY_LICENSE }}`;
