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

/**
 * What the pages rely on in the snippets, as messages; empty when they hold all of it: the feed and the package
 * patterns the install page describes, the variables and the licence key's setting it names, and the login
 * placeholder it replaces.
 *
 * @param {{ nugetConfig: string, feedCredentials: string, licenceUserSecret: string, ciWorkflow: string }} snippets
 */
export function snippetProblems(snippets) {
  const required = {
    nugetConfig: [
      `"${GUIDE_FEED}index.json"`,
      '<package pattern="Tenantry.Pro" />',
      '<package pattern="Tenantry.Pro.*" />',
      `%${FEED_USERNAME_VARIABLE}%`,
      `%${FEED_TOKEN_VARIABLE}%`,
    ],
    feedCredentials: [`export ${FEED_USERNAME_VARIABLE}=${LOGIN_PLACEHOLDER}`, `export ${FEED_TOKEN_VARIABLE}=`],
    licenceUserSecret: [`dotnet user-secrets set "${LICENCE_CONFIG_KEY}"`],
    ciWorkflow: [`${FEED_USERNAME_VARIABLE}: `, `${FEED_TOKEN_VARIABLE}: `, `${LICENCE_ENV_VARIABLE}: `],
  };
  return Object.entries(required).flatMap(([name, texts]) =>
    texts.filter((text) => !snippets[name].includes(text)).map((text) => `${name} has no ${text}`),
  );
}

/**
 * The setup snippets of Pro's installation guide, as the Pro access page shows them: the nuget.config, setting the
 * feed credentials on macOS or Linux (without its comment line), setting the licence key with user secrets, and the
 * GitHub Actions job. Throws when the guide has no such block, or a snippet lacks what the pages rely on
 * (snippetProblems), so a guide the pages cannot show stops the docs-versions run before anything is committed.
 *
 * @param {string} guide
 */
export function installSnippets(guide) {
  const find = (language, text) => {
    const block = codeBlocks(guide, language).find((code) => code.includes(text));
    if (block === undefined) throw new Error(`the installation guide has no \`\`\`${language} block with "${text}".`);
    return block;
  };
  const snippets = {
    nugetConfig: find('xml', `%${FEED_TOKEN_VARIABLE}%`),
    feedCredentials: find('bash', `export ${FEED_USERNAME_VARIABLE}=`)
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .join('\n'),
    licenceUserSecret: find('bash', `dotnet user-secrets set "${LICENCE_CONFIG_KEY}"`).trimEnd(),
    ciWorkflow: find('yaml', `${FEED_TOKEN_VARIABLE}: `).trimEnd(),
  };
  const problems = snippetProblems(snippets);
  if (problems.length > 0) throw new Error(`the installation guide's snippets: ${problems.join('; ')}.`);
  return snippets;
}
