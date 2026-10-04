import { describe, expect, it } from 'vitest';
import { installSnippets, snippetProblems } from './install-snippets.mjs';

const fence = '```';
const guide = `# Installation

${fence}xml
<packageSources>
  <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
</packageSources>
${fence}

${fence}xml
<configuration>
  <add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-org/index.json" />
  <package pattern="Tenantry.Pro" />
  <package pattern="Tenantry.Pro.*" />
  <add key="Username" value="%TENANTRY_GITHUB_USERNAME%" />
  <add key="ClearTextPassword" value="%TENANTRY_GITHUB_PAT%" />
</configuration>
${fence}

${fence}bash
# macOS / Linux
export TENANTRY_GITHUB_USERNAME=your-github-username
export TENANTRY_GITHUB_PAT=ghp_your_token
${fence}

${fence}bash
export PATH=$PATH:~/.dotnet/tools
dotnet add package Tenantry.Pro
${fence}

${fence}bash
dotnet user-secrets init
dotnet user-secrets set "Tenantry:License" "<your licence key>"
${fence}

${fence}yaml
on: push
${fence}

${fence}yaml
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TENANTRY_GITHUB_USERNAME: x
      TENANTRY_GITHUB_PAT: y
      Tenantry__License: z
${fence}
`;

const snippets = installSnippets(guide);

describe('install snippets', () => {
  it('takes the Pro access page’s snippets from the blocks that hold Tenantry’s names', () => {
    expect(snippets).toEqual({
      nugetConfig:
        '<configuration>\n  <add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-org/index.json" />\n' +
        '  <package pattern="Tenantry.Pro" />\n  <package pattern="Tenantry.Pro.*" />\n' +
        '  <add key="Username" value="%TENANTRY_GITHUB_USERNAME%" />\n' +
        '  <add key="ClearTextPassword" value="%TENANTRY_GITHUB_PAT%" />\n</configuration>\n',
      feedCredentials:
        'export TENANTRY_GITHUB_USERNAME=your-github-username\nexport TENANTRY_GITHUB_PAT=ghp_your_token',
      licenceUserSecret: 'dotnet user-secrets init\ndotnet user-secrets set "Tenantry:License" "<your licence key>"',
      ciWorkflow:
        'jobs:\n  build:\n    runs-on: ubuntu-latest\n    env:\n      TENANTRY_GITHUB_USERNAME: x\n' +
        '      TENANTRY_GITHUB_PAT: y\n      Tenantry__License: z',
    });
  });

  it('refuses a guide without one of the blocks', () => {
    expect(() => installSnippets(guide.replace('```yaml\njobs', '```yml\njobs'))).toThrow(
      'the installation guide has no ```yaml block with "TENANTRY_GITHUB_PAT: ".',
    );
  });

  it('refuses snippets without what the pages rely on, naming each', () => {
    expect(() => installSnippets(guide.replace('Tenantry.Pro.*', 'Tenantry.Pro.Extra'))).toThrow(
      'nugetConfig has no <package pattern="Tenantry.Pro.*" />',
    );
    expect(() => installSnippets(guide.replace('tenantry-org', 'another-org'))).toThrow(
      'nugetConfig has no "https://nuget.pkg.github.com/tenantry-org/index.json"',
    );
    expect(
      snippetProblems({ ...snippets, ciWorkflow: 'jobs:', feedCredentials: 'export TENANTRY_GITHUB_USERNAME=me' }),
    ).toEqual([
      'feedCredentials has no export TENANTRY_GITHUB_USERNAME=your-github-username',
      'feedCredentials has no export TENANTRY_GITHUB_PAT=',
      'ciWorkflow has no TENANTRY_GITHUB_USERNAME: ',
      'ciWorkflow has no TENANTRY_GITHUB_PAT: ',
      'ciWorkflow has no Tenantry__License: ',
    ]);
  });
});
