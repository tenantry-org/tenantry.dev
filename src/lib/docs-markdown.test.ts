import { describe, expect, it, vi } from 'vitest';
import { absoluteLinks, llmsFullTxt, llmsTxt, markdownDocument, type MarkdownPage } from './docs-markdown';

// vi.mock is hoisted above the import: two published versions, the newest first.
vi.mock('../../docs-versions.json', () => ({
  default: {
    versions: [
      { version: '0.6', core: 'v0.6.2', pro: 'v0.6.1' },
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.0' },
    ],
  },
}));

const page = (url: string, title: string, description?: string, markdown = `${title} text.`): MarkdownPage => ({
  url,
  slugs: url.split('/').slice(2),
  title,
  description,
  markdown,
});

const pages = [
  page('/docs', 'Tenantry documentation'),
  page('/docs/core', 'Tenantry Core', 'What Core does.'),
  page('/docs/core/getting-started', 'Getting started', 'Install and configure.'),
  page('/docs/core/api', 'API reference', 'Every public type.'),
  page('/docs/core/api/tenantry-itenantstore', 'ITenantStore', 'Reads tenants.'),
  page('/docs/core/ai-agents', 'AI agents', 'Using Tenantry with an AI agent.'),
  page('/docs/pro', 'Tenantry Pro'),
  page('/docs/pro/installation', 'Installation', 'The package feed.'),
  page('/docs/pro/api/tenantry-pro-itenantprovisioner', 'ITenantProvisioner'),
  page('/docs/v0.5/core/getting-started', 'Getting started', 'Old.'),
  // A version docs-versions.json does not list: never published, even if its pages were synced.
  page('/docs/v0.4/core/getting-started', 'Getting started', 'Hidden.'),
];

describe('docs as Markdown', () => {
  const posts = [{ url: '/blog/a-post', title: 'A post', description: 'What it shows.' }];

  it('lists the pages about Tenantry, the newest docs only, Core with its ai-agents page first, then Pro, and the API references and posts as optional', () => {
    expect(llmsTxt(pages, posts, null)).toBe(
      [
        '# Tenantry',
        '> Tenantry adds multi-tenancy, with tenant isolation, to ASP.NET Core and EF Core applications. Tenantry ' +
          'Core is open source (Apache-2.0) and free for commercial use; Tenantry Pro, a subscription, adds ' +
          'provisioning and offboarding, migrations across tenant databases, schema per tenant and mixed mode, the ' +
          'tenant in background jobs and messages, and audit logging.',
        'These are the docs of the newest release, Tenantry 0.6 (Core v0.6.2, Pro v0.6.1), as Markdown. Each page is ' +
          'also a web page at the same address without `.md`. Tenantry is in beta until 1.0. ' +
          "Earlier releases' docs: [0.5](https://tenantry.dev/docs/v0.5.md).",
        [
          '## About',
          '- [Tenantry Pro](https://tenantry.dev/pro): what Pro adds, what the subscription includes, and its pricing.',
          '- [How Tenantry compares](https://tenantry.dev/compare): Tenantry beside your own query filters, ' +
            'Finbuckle.MultiTenant and ABP, with sources, and what Tenantry does not do.',
        ].join('\n'),
        [
          '## Tenantry Core',
          '- [AI agents](https://tenantry.dev/docs/core/ai-agents.md): Using Tenantry with an AI agent.',
          '- [Tenantry Core](https://tenantry.dev/docs/core.md): What Core does.',
          '- [Getting started](https://tenantry.dev/docs/core/getting-started.md): Install and configure.',
        ].join('\n'),
        [
          '## Tenantry Pro',
          '- [Tenantry Pro](https://tenantry.dev/docs/pro.md)',
          '- [Installation](https://tenantry.dev/docs/pro/installation.md): The package feed.',
        ].join('\n'),
        [
          '## Optional',
          '- [Core API reference](https://tenantry.dev/docs/core/api.md): Every public type.',
          '- [Core API: ITenantStore](https://tenantry.dev/docs/core/api/tenantry-itenantstore.md): Reads tenants.',
          '- [Pro API: ITenantProvisioner](https://tenantry.dev/docs/pro/api/tenantry-pro-itenantprovisioner.md)',
          '- [Blog: A post](https://tenantry.dev/blog/a-post): What it shows.',
        ].join('\n'),
      ].join('\n\n') + '\n',
    );
    expect(llmsTxt(pages, posts, null)).not.toMatch(/v0\.4|Hidden|Old\.|costs/);
  });

  it("states Pro's price, when it could be read, with the line that links the Pro page", () => {
    expect(llmsTxt(pages, posts, { month: '£15', year: '£150' })).toContain(
      '- [Tenantry Pro](https://tenantry.dev/pro): what Pro adds, what the subscription includes, and its pricing. ' +
        'Pro costs £15 a month or £150 a year for your whole company. ' +
        'The checkout shows the price in your currency, with any tax.\n',
    );
  });

  it("puts the newest guides in one file, without the API references or another version's pages", () => {
    const full = llmsFullTxt(pages);
    expect([...full.matchAll(/^# (.+)$/gm)].map((match) => match[1])).toEqual([
      'AI agents',
      'Tenantry Core',
      'Getting started',
      'Tenantry Pro',
      'Installation',
    ]);
    expect(full).not.toMatch(/ITenantStore|v0\.[45]/);
  });

  it('makes links to the site absolute, and links to docs pages links to their Markdown, outside code', () => {
    const markdown =
      '[setup](/docs/core/getting-started#install) [home](/docs) [old](/docs/v0.5/core/) [access](/dashboard/pro) ' +
      '[here](#below) [docs](https://learn.microsoft.com/ef/)\n\n```md\n[kept](/docs/core)\n```\n\n[after](/docs/pro)';
    expect(absoluteLinks(markdown)).toBe(
      '[setup](https://tenantry.dev/docs/core/getting-started.md#install) [home](https://tenantry.dev/docs.md) ' +
        '[old](https://tenantry.dev/docs/v0.5/core.md) [access](https://tenantry.dev/dashboard/pro) [here](#below) ' +
        '[docs](https://learn.microsoft.com/ef/)\n\n```md\n[kept](/docs/core)\n```\n\n' +
        '[after](https://tenantry.dev/docs/pro.md)',
    );
  });

  it('leaves a code block alone up to the fence that closes it: one as long or longer, of the same character', () => {
    const markdown = [
      '````md',
      '```cs',
      '[in four](/docs/core)',
      '```',
      '[still in four](/docs/core)',
      '````',
      '[between](/docs/core)',
      '~~~',
      '[in tilde](/docs/core)',
      '```',
      '[still in tilde](/docs/core)',
      '~~~~',
      '[after](/docs/pro)',
    ].join('\n');
    expect(absoluteLinks(markdown)).toBe(
      markdown
        .replace('[between](/docs/core)', '[between](https://tenantry.dev/docs/core.md)')
        .replace('[after](/docs/pro)', '[after](https://tenantry.dev/docs/pro.md)'),
    );
  });

  it('heads a page with its title and the version it is of', () => {
    expect(markdownDocument(page('/docs/core/getting-started', 'Getting started', '', 'See [Pro](/docs/pro).'))).toBe(
      '# Getting started\n\nThe docs of Tenantry 0.6 (Core v0.6.2, Pro v0.6.1), the newest release. Web page: ' +
        'https://tenantry.dev/docs/core/getting-started\n\nSee [Pro](https://tenantry.dev/docs/pro.md).\n',
    );
    expect(markdownDocument(page('/docs', 'Tenantry documentation', '', 'Guides.'))).toBe(
      '# Tenantry documentation\n\nThe docs of Tenantry 0.6 (Core v0.6.2, Pro v0.6.1), the newest release. Their ' +
        'pages are listed at https://tenantry.dev/llms.txt. Web page: https://tenantry.dev/docs\n\nGuides.\n',
    );
    expect(markdownDocument(page('/docs/v0.5/core', 'Tenantry Core'))).toContain(
      'The docs of Tenantry 0.5 (Core v0.5.0, Pro v0.5.0). The newest release is 0.6, whose docs are listed at ' +
        'https://tenantry.dev/llms.txt.',
    );
  });
});
