import { describe, expect, it } from 'vitest';
import { brokenDocsLinks, headingIds, linkApiTypes, relativeLinks, rewriteLinks } from './docs-links.mjs';

const core = { repository: 'https://github.com/tenantry-org/tenantry-core', ref: 'abc123' };
const pro = { repository: 'https://github.com/tenantry-org/tenantry-pro-docs', ref: 'v0.1.0' };

describe('rewriteLinks', () => {
  it('turns links between pages into absolute paths in the same docs group', () => {
    expect(rewriteLinks('See [stores](tenant-stores.md) and [ordering](pipeline.md#pipeline-ordering).', 'core')).toBe(
      'See [stores](/docs/core/tenant-stores) and [ordering](/docs/core/pipeline#pipeline-ordering).',
    );
    expect(rewriteLinks('[start](./getting-started.md)', 'pro')).toBe('[start](/docs/pro/getting-started)');
  });

  it("points README at the group's landing page", () => {
    expect(rewriteLinks('[overview](README.md)', 'pro')).toBe('[overview](/docs/pro)');
  });

  it("maps links to Core's docs on GitHub onto the site's Core docs", () => {
    expect(
      rewriteLinks('[hosts](https://github.com/tenantry-org/tenantry-core/blob/main/docs/non-http-hosts.md)', 'pro'),
    ).toBe('[hosts](/docs/core/non-http-hosts)');
  });

  it('leaves absolute URLs, site paths and anchors alone', () => {
    const untouched = '[spec](https://example.com/spec.md) [home](/pricing) [below](#install) [mail](mailto:a@b.c)';
    expect(rewriteLinks(untouched, 'core', core)).toBe(untouched);
  });

  it('points links outside the docs folder into the repository at the synced commit', () => {
    expect(rewriteLinks('[sample](../samples/TenantLifecycle) and [licence](../LICENSE)', 'pro', pro)).toBe(
      '[sample](https://github.com/tenantry-org/tenantry-pro-docs/tree/v0.1.0/samples/TenantLifecycle) and ' +
        '[licence](https://github.com/tenantry-org/tenantry-pro-docs/tree/v0.1.0/LICENSE)',
    );
    expect(rewriteLinks('[aot](../samples/Tenantry.Samples.Aot)', 'core', core)).toBe(
      '[aot](https://github.com/tenantry-org/tenantry-core/tree/abc123/samples/Tenantry.Samples.Aot)',
    );
  });
});

describe('rewriteLinks in a subfolder', () => {
  it('resolves links from the API reference relative to its folder', () => {
    expect(rewriteLinks('[scope](tenantry-core-itenantscope.md) [index](README.md)', 'core', core, 'api')).toBe(
      '[scope](/docs/core/api/tenantry-core-itenantscope) [index](/docs/core/api)',
    );
    expect(rewriteLinks('[guide](../core-concepts.md#scopes)', 'core', core, 'api')).toBe(
      '[guide](/docs/core/core-concepts#scopes)',
    );
    expect(rewriteLinks('[sample](../../samples/X)', 'core', core, 'api')).toBe(
      '[sample](https://github.com/tenantry-org/tenantry-core/tree/abc123/samples/X)',
    );
  });

  it("keeps links to the site's own pages on the site", () => {
    expect(rewriteLinks('[`ITenantStore`](https://tenantry.dev/docs/core/api/tenantry-core-itenantstore)', 'pro')).toBe(
      '[`ITenantStore`](/docs/core/api/tenantry-core-itenantstore)',
    );
  });

  it('links from a guide into the API reference', () => {
    expect(rewriteLinks('[API reference](api/README.md)', 'pro', pro)).toBe('[API reference](/docs/pro/api)');
  });
});

describe('rewriteLinks for an older docs version', () => {
  const base = '/docs/v0.4';

  it("keeps links between pages, Core's GitHub docs and API links within that version", () => {
    expect(rewriteLinks('[start](getting-started.md#setup) [home](README.md)', 'pro', pro, '', base)).toBe(
      '[start](/docs/v0.4/pro/getting-started#setup) [home](/docs/v0.4/pro)',
    );
    expect(
      rewriteLinks(
        '[hosts](https://github.com/tenantry-org/tenantry-core/blob/v0.4.0/docs/non-http-hosts.md)',
        'pro',
        pro,
        '',
        base,
      ),
    ).toBe('[hosts](/docs/v0.4/core/non-http-hosts)');
    expect(rewriteLinks('[scope](../core-concepts.md)', 'core', core, 'api', base)).toBe(
      '[scope](/docs/v0.4/core/core-concepts)',
    );
    expect(
      rewriteLinks(
        '[`ITenantStore`](https://tenantry.dev/docs/core/api/tenantry-core-itenantstore)',
        'pro',
        pro,
        '',
        base,
      ),
    ).toBe('[`ITenantStore`](/docs/v0.4/core/api/tenantry-core-itenantstore)');
  });

  it('leaves other site links, and links into the repository, alone', () => {
    expect(
      rewriteLinks('[pricing](https://tenantry.dev/pricing) [docs](https://tenantry.dev/docs)', 'pro', pro, '', base),
    ).toBe('[pricing](/pricing) [docs](/docs)');
    expect(rewriteLinks('[sample](../samples/X)', 'pro', pro, '', base)).toBe(
      '[sample](https://github.com/tenantry-org/tenantry-pro-docs/tree/v0.1.0/samples/X)',
    );
  });
});

describe('relativeLinks', () => {
  it('lists links that would resolve under the site', () => {
    const markdown = '[a](../samples/X) [b](other/page) [c](/docs/core) [d](https://x.dev) [e](#top)';
    expect(relativeLinks(markdown)).toEqual(['../samples/X', 'other/page']);
  });

  it('finds none once links are rewritten', () => {
    expect(relativeLinks(rewriteLinks('[s](../samples/X) [p](page.md)', 'core', core))).toEqual([]);
  });
});

describe('linkApiTypes', () => {
  const types = new Map([
    ['ITenantScope', '/docs/core/api/tenantry-core-itenantscope'],
    ['TenantDescriptor', '/docs/core/api/tenantry-core-tenantdescriptor'],
  ]);

  it("links a type's first mention as code, with or without its type parameters", () => {
    expect(linkApiTypes('Use `ITenantScope<TKey>`; each `ITenantScope` restores. See `TenantDescriptor`.', types)).toBe(
      'Use [`ITenantScope<TKey>`](/docs/core/api/tenantry-core-itenantscope); each `ITenantScope` restores. ' +
        'See [`TenantDescriptor`](/docs/core/api/tenantry-core-tenantdescriptor).',
    );
  });

  it('leaves code blocks, headings, existing links and unknown names alone', () => {
    const markdown = [
      '## The `ITenantScope` interface',
      '```csharp',
      'ITenantScope scope = `ITenantScope`;',
      '```',
      '[`ITenantScope`](elsewhere.md) and `IServiceProvider`',
    ].join('\n');
    expect(linkApiTypes(markdown, types)).toBe(markdown);
  });
});

describe('headingIds', () => {
  it('gives each heading the id the site gives it', () => {
    const ids = headingIds(
      [
        '# Licensing',
        '## When the key is checked',
        '## `OnMissingTenant` — what happens when a write runs with no tenant',
        '## [Installation](/docs/pro/installation) and **CI**',
        '## Custom heading [#custom-id]',
        '## When the key is checked',
        '```md',
        '## Not a heading',
        '```',
      ].join('\n'),
    );

    expect([...ids]).toEqual([
      'licensing',
      'when-the-key-is-checked',
      'onmissingtenant--what-happens-when-a-write-runs-with-no-tenant',
      'installation-and-ci',
      'custom-id',
      'when-the-key-is-checked-1',
    ]);
  });
});

describe('brokenDocsLinks', () => {
  const pages = new Map([
    ['/docs/core', '# Tenantry Core\n\n[Stores](/docs/core/tenant-stores#caching) [Pro](/docs/pro)'],
    ['/docs/core/tenant-stores', '# Tenant stores\n\n## Caching\n\n[Up](#tenant-stores) [Missing](#nothing)'],
    ['/docs/pro', '# Tenantry Pro\n\n[Gone](/docs/core/renamed) [Heading](/docs/core/tenant-stores#renamed)'],
    ['/docs/v0.4/core', '# Tenantry Core\n\n[Pricing](/#pricing) [GitHub](https://github.com/tenantry-org)'],
  ]);

  it('reports links to pages and headings the sync did not write, and nothing else', () => {
    expect(brokenDocsLinks(pages, '/docs')).toEqual([
      '/docs/core/tenant-stores: #nothing',
      '/docs/pro: /docs/core/renamed',
      '/docs/pro: /docs/core/tenant-stores#renamed',
    ]);
  });
});
