import { initAdvancedSearch } from 'fumadocs-core/search/server';
import { describe, expect, it } from 'vitest';
import { searchIndex } from './search-index';

// Two API reference pages whose URLs differ by `-1`, as `ITenantBuilder` and `ITenantBuilder<TKey>` do.
function page(slug: string, title: string) {
  return {
    url: `/docs/core/api/${slug}`,
    slugs: ['core', 'api', slug],
    data: {
      title,
      description: `The ${title} interface.`,
      structuredData: {
        headings: [{ id: 'methods', content: 'Methods' }],
        contents: [
          { heading: undefined, content: `${title} configures a tenant.` },
          { heading: 'methods', content: 'UseTenantry registers the services.' },
        ],
      },
    },
  };
}

describe('search index', () => {
  it('indexes a page whose URL is another page’s with -1 on the end', async () => {
    const pages = [
      page('tenantry-itenantbuilder', 'ITenantBuilder'),
      page('tenantry-itenantbuilder-1', 'ITenantBuilder<TKey>'),
    ];
    const search = initAdvancedSearch({ indexes: pages.map(searchIndex) });

    const results = await search.search('UseTenantry');
    expect(results.map((result) => result.url)).toEqual(
      expect.arrayContaining([
        '/docs/core/api/tenantry-itenantbuilder#methods',
        '/docs/core/api/tenantry-itenantbuilder-1#methods',
      ]),
    );
  });
});
