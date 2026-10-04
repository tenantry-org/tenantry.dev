import { describe, expect, it } from 'vitest';
import { installSnippets, snippetProblems } from './install-snippets.mjs';

const fence = '```';
const nugetConfig = `<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="tenantry-pro" value="https://nuget.pkg.github.com/tenantry-org/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="tenantry-pro">
      <package pattern="Tenantry.Pro" />
      <package pattern="Tenantry.Pro.*" />
    </packageSource>
  </packageSourceMapping>
  <packageSourceCredentials>
    <tenantry-pro>
      <add key="Username" value="%TENANTRY_GITHUB_USERNAME%" />
      <add key="ClearTextPassword" value="%TENANTRY_GITHUB_PAT%" />
    </tenantry-pro>
  </packageSourceCredentials>
</configuration>
`;
const ciWorkflow = `jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TENANTRY_GITHUB_USERNAME: \${{ vars.TENANTRY_GITHUB_USERNAME }}
      TENANTRY_GITHUB_PAT: \${{ secrets.TENANTRY_GITHUB_PAT }}
    steps:
      - run: dotnet test
        env:
          Tenantry__License: \${{ secrets.TENANTRY_LICENSE }}`;

// Shaped like Pro's docs/installation.md, with blocks that hold Tenantry's names but are not the snippets.
const guide = `# Installation

${fence}xml
<packageSources>
  <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
</packageSources>
${fence}

${fence}xml
${nugetConfig}${fence}

${fence}bash
# macOS / Linux
export TENANTRY_GITHUB_USERNAME=your-github-username
export TENANTRY_GITHUB_PAT=ghp_your_token
${fence}

${fence}bash
dotnet user-secrets init
dotnet user-secrets set "Tenantry:License" "<your licence key>"
${fence}

${fence}yaml
${ciWorkflow}
${fence}
`;

const snippets = installSnippets(guide);

describe('install snippets', () => {
  it('takes the Pro access page’s snippets from the blocks that hold Tenantry’s names', () => {
    expect(snippets).toEqual({
      nugetConfig,
      feedCredentials:
        'export TENANTRY_GITHUB_USERNAME=your-github-username\nexport TENANTRY_GITHUB_PAT=ghp_your_token',
      licenceUserSecret: 'dotnet user-secrets init\ndotnet user-secrets set "Tenantry:License" "<your licence key>"',
      ciWorkflow,
    });
    expect(snippetProblems(snippets)).toEqual([]);
  });

  it('takes the first block that holds what the pages rely on, past an earlier one that does not', () => {
    const earlier = `${fence}bash\nexport TENANTRY_GITHUB_USERNAME=\${{ vars.TENANTRY_GITHUB_USERNAME }}\n${fence}\n\n`;
    expect(installSnippets(earlier + guide).feedCredentials).toBe(snippets.feedCredentials);
  });

  it('refuses a guide without one of the blocks', () => {
    expect(() => installSnippets(guide.replace('```yaml', '```yml'))).toThrow(
      'the installation guide has no ```yaml block with "TENANTRY_GITHUB_PAT: ".',
    );
  });

  it('refuses a second package source, a real-looking token or a key in place of a secret', () => {
    const extraSource = guide.replace(
      '<add key="tenantry-pro"',
      '<add key="mirror" value="https://feed.example.com/index.json" />\n    <add key="tenantry-pro"',
    );
    expect(() => installSnippets(extraSource)).toThrow(
      "nugetConfig's sources besides nuget.org are https://feed.example.com/index.json, " +
        'https://nuget.pkg.github.com/tenantry-org/index.json, not https://nuget.pkg.github.com/tenantry-org/index.json',
    );
    expect(() => installSnippets(guide.replace('tenantry-org', 'another-org'))).toThrow('not https://nuget.pkg');
    expect(() => installSnippets(guide.replace('ghp_your_token', 'ghp_a1B2c3D4e5F6g7H8i9J0'))).toThrow(
      'feedCredentials sets TENANTRY_GITHUB_PAT other than to ghp_your_token',
    );
    expect(() => installSnippets(guide.replace('${{ secrets.TENANTRY_GITHUB_PAT }}', 'ghp_a1B2c3D4'))).toThrow(
      'ciWorkflow has no TENANTRY_GITHUB_PAT: ${{ secrets.TENANTRY_GITHUB_PAT }}',
    );
  });

  it('names each missing part', () => {
    expect(
      snippetProblems({ ...snippets, nugetConfig: snippets.nugetConfig.replace('Tenantry.Pro.*', 'Tenantry.Pro.X') }),
    ).toEqual(['nugetConfig has no <package pattern="Tenantry.Pro.*" />']);
  });
});
