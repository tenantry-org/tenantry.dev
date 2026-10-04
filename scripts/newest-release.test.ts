import { describe, expect, it } from 'vitest';
import { dotnetVersions, installSnippets } from './newest-release.mjs';

const fence = '```';
const guide = `# Installation

${fence}xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-org/index.json" />
  </packageSources>
</configuration>
${fence}

${fence}bash
# macOS / Linux
export TENANTRY_GITHUB_USERNAME=your-github-username
export TENANTRY_GITHUB_PAT=ghp_your_token
${fence}

${fence}bash
dotnet add package Tenantry.Pro
${fence}

${fence}bash
dotnet user-secrets init
dotnet user-secrets set "Tenantry:License" "<your licence key>"
${fence}

${fence}yaml
jobs:
  build:
    runs-on: ubuntu-latest
${fence}
`;

describe('newest release', () => {
  it('reads the .NET versions a nuspec targets, oldest first, each once', () => {
    const nuspec =
      '<group targetFramework="net10.0" /><group targetFramework="net8.0"><dependency id="A" /></group>' +
      '<group targetFramework="net9.0" /><group targetFramework="net10.0" />';
    expect(dotnetVersions(nuspec)).toEqual(['8', '9', '10']);
    expect(() => dotnetVersions('<metadata />')).toThrow('names no .NET target framework');
  });

  it('takes the Pro access page’s snippets from the installation guide', () => {
    expect(installSnippets(guide)).toEqual({
      nugetConfig:
        '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n' +
        '    <add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-org/index.json" />\n' +
        '  </packageSources>\n</configuration>\n',
      feedCredentials:
        'export TENANTRY_GITHUB_USERNAME=your-github-username\nexport TENANTRY_GITHUB_PAT=ghp_your_token',
      licenceUserSecret: 'dotnet user-secrets init\ndotnet user-secrets set "Tenantry:License" "<your licence key>"',
      ciWorkflow: 'jobs:\n  build:\n    runs-on: ubuntu-latest',
    });
  });

  it('refuses a guide without one of them', () => {
    expect(() => installSnippets(guide.replace('```yaml', '```yml'))).toThrow(
      'the installation guide has no ```yaml block with "runs-on:".',
    );
  });
});
