/**
 * The setup snippets the site shows for restoring Tenantry Pro from the package feed: the Install page, the welcome
 * email and the licence key card. The site serves the feed, so it writes these itself, with this deployment's own
 * address (`feedUrl`): the sandbox shows the sandbox's feed and production its own. Pro's installation guide describes
 * the same setup with production's address; the names below (the source key and the environment variable) are the
 * ones it uses, so a nuget.config written from either works with the other's instructions.
 */

/** Where the feed is served on the site (src/app/feed/v3); its service index is `index.json` under it. */
export const FEED_PATH = '/feed/v3';

/**
 * The package source's key in nuget.config, which its credentials element is named after. It has no hyphen, so the
 * variable NuGet reads credentials from for it, NuGetPackageSourceCredentials_TenantryPro, can be set from a shell.
 */
export const FEED_SOURCE_KEY = 'TenantryPro';

/** The environment variable nuget.config reads the feed token from. */
export const FEED_TOKEN_VARIABLE = 'TENANTRY_FEED_TOKEN';

/** Where Tenantry.Pro reads the licence key from: the configuration key, and its environment-variable form. */
export const LICENCE_CONFIG_KEY = 'Tenantry:License';
export const LICENCE_ENV_VARIABLE = 'Tenantry__License';

/** The feed's service index on the site at `siteUrl` (an origin, such as https://tenantry.dev). */
export function feedUrl(siteUrl: string): string {
  return `${siteUrl}${FEED_PATH}/index.json`;
}

/**
 * A nuget.config for a solution: nuget.org for everything, the package feed for Tenantry Pro's packages, and the feed
 * token from an environment variable. NuGet sends any username with the token as the password.
 */
export function nugetConfig(siteUrl: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="${FEED_SOURCE_KEY}" value="${feedUrl(siteUrl)}" protocolVersion="3" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
    <packageSource key="${FEED_SOURCE_KEY}">
      <package pattern="Tenantry.Pro" />
      <package pattern="Tenantry.Pro.*" />
    </packageSource>
  </packageSourceMapping>
  <packageSourceCredentials>
    <${FEED_SOURCE_KEY}>
      <add key="Username" value="tenantry" />
      <add key="ClearTextPassword" value="%${FEED_TOKEN_VARIABLE}%" />
    </${FEED_SOURCE_KEY}>
  </packageSourceCredentials>
</configuration>
`;
}

/** Setting the feed token on a developer machine: macOS or Linux, then Windows. */
export const feedTokenShell = `export ${FEED_TOKEN_VARIABLE}=tpf_your_feed_token`;
export const feedTokenPowerShell = `[Environment]::SetEnvironmentVariable('${FEED_TOKEN_VARIABLE}', 'tpf_your_feed_token', 'User')`;

/** Adding Tenantry Pro's packages to a project; the job and message integrations are added the same way. */
export const addProPackages = `dotnet add package Tenantry.Pro
dotnet add package Tenantry.Pro.EfCore`;

/** Restoring with the lock file: the first restore writes packages.lock.json, which is committed. */
export const lockFileProperty = `<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>`;
export const lockedRestore = 'dotnet restore --locked-mode';

/** A GitHub Actions job restoring from the feed in locked mode and running the tests with the licence key. */
export const ciWorkflow = `jobs:
  build:
    runs-on: ubuntu-latest
    env:
      ${FEED_TOKEN_VARIABLE}: \${{ secrets.${FEED_TOKEN_VARIABLE} }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: 10.0.x
      - run: dotnet restore --locked-mode
      - run: dotnet build --no-restore
      - run: dotnet test --no-build
        env:
          ${LICENCE_ENV_VARIABLE}: \${{ secrets.TENANTRY_LICENSE }}`;

/**
 * A Dockerfile's restore with the token as a build secret, so no image layer keeps it, and the build command. The
 * restore needs the solution's Directory.Build.props and Directory.Packages.props where they exist: they can set the
 * target frameworks, the lock file property and the package versions. The wildcard copies whichever of them exist, and
 * nuget.config keeps the COPY valid when neither does.
 */
export const dockerRestore = `# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY nuget.config Directory.*.props ./
COPY src/MyApp/MyApp.csproj src/MyApp/packages.lock.json src/MyApp/
RUN --mount=type=secret,id=tenantry_feed_token,env=${FEED_TOKEN_VARIABLE} \\
    dotnet restore src/MyApp --locked-mode
COPY . .
RUN dotnet publish src/MyApp -c Release --no-restore -o /app`;
export const dockerBuild = `docker build --secret id=tenantry_feed_token,env=${FEED_TOKEN_VARIABLE} .`;

/** Storing the licence key with user secrets, from the application's project directory. */
export const licenceUserSecret = `dotnet user-secrets init
dotnet user-secrets set "${LICENCE_CONFIG_KEY}" "<your licence key>"`;
