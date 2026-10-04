/**
 * The Pro access page's setup snippets, taken from Pro's installation guide (docs/installation.md at a release tag),
 * and the names the pages' own text gives for them. The docs-versions workflow copies the snippets into
 * newest-release.json (newest-release.mjs); src/lib/install-snippets.ts shows them. No Node imports: the site's
 * pages import this file too.
 */

/** Environment variables the `nuget.config` reads the feed credentials from. */
export const FEED_USERNAME_VARIABLE = 'TENANTRY_GITHUB_USERNAME';
export const FEED_TOKEN_VARIABLE = 'TENANTRY_GITHUB_PAT';

/** Where Tenantry.Pro reads the licence key from: the configuration key, and its environment-variable form. */
export const LICENCE_CONFIG_KEY = 'Tenantry:License';
export const LICENCE_ENV_VARIABLE = 'Tenantry__License';

/** The feed in the guide's nuget.config, which the page replaces with the environment's org. */
export const GUIDE_FEED = 'https://nuget.pkg.github.com/tenantry-org/';

/** The guide's placeholder for the GitHub login, which the page replaces with the connected account's. */
export const LOGIN_PLACEHOLDER = 'your-github-username';

function codeBlocks(markdown, language) {
  return [...markdown.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map((match) => match[1]);
}

const NUGET_ORG = 'https://api.nuget.org/v3/index.json';

/** The guide's placeholder for the token, which the page shows as it is. */
export const TOKEN_PLACEHOLDER = 'ghp_your_token';

/**
 * What the pages rely on in one snippet, as messages; empty when it holds all of it: the feed, as nuget.org's only
 * companion, and the package patterns the install page describes, the variables and the licence key's setting it
 * names, the login placeholder it replaces, and placeholders or secrets in place of the token and the key.
 *
 * @param {'nugetConfig' | 'feedCredentials' | 'licenceUserSecret' | 'ciWorkflow'} name
 * @param {string} text
 */
export function snippetProblem(name, text) {
  const problems = [];
  const require = (...required) =>
    problems.push(...required.filter((part) => !text.includes(part)).map((part) => `${name} has no ${part}`));

  if (name === 'nugetConfig') {
    require('<package pattern="Tenantry.Pro" />', '<package pattern="Tenantry.Pro.*" />', `%${FEED_USERNAME_VARIABLE}%`, `%${FEED_TOKEN_VARIABLE}%`);
    const sources = /<packageSources>([\s\S]*?)<\/packageSources>/.exec(text)?.[1] ?? '';
    const others = [...sources.matchAll(/value="([^"]*)"/g)].map((match) => match[1]).filter((v) => v !== NUGET_ORG);
    if (others.join() !== `${GUIDE_FEED}index.json`) {
      problems.push(
        `nugetConfig's sources besides nuget.org are ${others.join(', ') || 'none'}, not ${GUIDE_FEED}index.json`,
      );
    }
  } else if (name === 'feedCredentials') {
    require(`export ${FEED_USERNAME_VARIABLE}=${LOGIN_PLACEHOLDER}`);
    const tokens = text.split('\n').filter((line) => line.includes(FEED_TOKEN_VARIABLE));
    if (tokens.join() !== `export ${FEED_TOKEN_VARIABLE}=${TOKEN_PLACEHOLDER}`) {
      problems.push(`feedCredentials sets ${FEED_TOKEN_VARIABLE} other than to ${TOKEN_PLACEHOLDER}`);
    }
  } else if (name === 'licenceUserSecret') {
    require(`dotnet user-secrets set "${LICENCE_CONFIG_KEY}" "<your licence key>"`);
  } else {
    require(`${FEED_USERNAME_VARIABLE}: `, `${FEED_TOKEN_VARIABLE}: \${{ secrets.${FEED_TOKEN_VARIABLE} }}`, `${LICENCE_ENV_VARIABLE}: \${{ secrets.`);
  }
  return problems;
}

/**
 * snippetProblem for each snippet.
 *
 * @param {{ nugetConfig: string, feedCredentials: string, licenceUserSecret: string, ciWorkflow: string }} snippets
 */
export function snippetProblems(snippets) {
  return Object.entries(snippets).flatMap(([name, text]) => snippetProblem(name, text));
}

/**
 * The setup snippets of Pro's installation guide, as the Pro access page shows them: the nuget.config, setting the
 * feed credentials on macOS or Linux (without its comment line), setting the licence key with user secrets, and the
 * GitHub Actions job. Each is the first block with Tenantry's names in it that holds what the pages rely on
 * (snippetProblem). Throws when the guide has none, so a guide the pages cannot show stops the docs-versions run
 * before anything is committed.
 *
 * @param {string} guide
 */
export function installSnippets(guide) {
  const find = (name, language, text, shape = (block) => block.trimEnd()) => {
    const blocks = codeBlocks(guide, language)
      .filter((code) => code.includes(text))
      .map(shape);
    if (blocks.length === 0) throw new Error(`the installation guide has no \`\`\`${language} block with "${text}".`);
    const block = blocks.find((candidate) => snippetProblem(name, candidate).length === 0);
    if (block === undefined) {
      throw new Error(`the installation guide's snippets: ${snippetProblem(name, blocks[0]).join('; ')}.`);
    }
    return block;
  };
  return {
    nugetConfig: find('nugetConfig', 'xml', `%${FEED_TOKEN_VARIABLE}%`, (block) => block),
    feedCredentials: find('feedCredentials', 'bash', `export ${FEED_USERNAME_VARIABLE}=`, (block) =>
      block
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .join('\n'),
    ),
    licenceUserSecret: find('licenceUserSecret', 'bash', `dotnet user-secrets set "${LICENCE_CONFIG_KEY}"`),
    ciWorkflow: find('ciWorkflow', 'yaml', `${FEED_TOKEN_VARIABLE}: `),
  };
}
