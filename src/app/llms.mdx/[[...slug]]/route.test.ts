import { describe, expect, it, vi } from 'vitest';
import { GET, generateStaticParams } from './route';

// Two published versions: 0.6, the newest, and 0.5.
vi.mock('../../../../docs-versions.json', () => ({
  default: {
    versions: [
      { version: '0.6', core: 'v0.6.0', pro: 'v0.6.0' },
      { version: '0.5', core: 'v0.5.0', pro: 'v0.5.0' },
    ],
  },
}));

// The docs as the sync writes them: only the versions docs-versions.json lists.
const pages = [
  { url: '/docs', slugs: [], title: 'Tenantry documentation' },
  { url: '/docs/core/getting-started', slugs: ['core', 'getting-started'], title: 'Getting started' },
  { url: '/docs/v0.5/core/getting-started', slugs: ['v0.5', 'core', 'getting-started'], title: 'Getting started' },
  { url: '/docs/v0.5/core/old-page', slugs: ['v0.5', 'core', 'old-page'], title: 'Old page' },
].map(({ url, slugs, title }) => ({
  url,
  slugs,
  data: { title, description: '', getText: async () => 'Read [tenant stores](/docs/core/tenant-stores).\n' },
}));

vi.mock('@/lib/source', () => ({
  source: {
    getPage: (slugs: string[]) => pages.find((page) => page.slugs.join('/') === slugs.join('/')),
    getPages: () => pages,
    generateParams: () => pages.map((page) => ({ slug: page.slugs })),
  },
}));

const get = (slug: string[]) => GET(new Request('https://tenantry.dev/'), { params: Promise.resolve({ slug }) });

describe("a docs page's Markdown", () => {
  it('is prerendered for every page', () => {
    expect(generateStaticParams()).toEqual(pages.map((page) => ({ slug: page.slugs })));
  });

  it('is served as Markdown, with absolute links and the web page as its canonical address', async () => {
    const response = await get(['core', 'getting-started']);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Link')).toBe('<https://tenantry.dev/docs/core/getting-started>; rel="canonical"');
    expect(await response.text()).toBe(
      '# Getting started\n\nThe docs of Tenantry 0.6 (Core v0.6.0, Pro v0.6.0), the newest release. Web page: ' +
        'https://tenantry.dev/docs/core/getting-started\n\n' +
        'Read [tenant stores](https://tenantry.dev/docs/core/tenant-stores.md).\n',
    );
  });

  it("names the latest web page as an older version's canonical address, as the older web page does", async () => {
    const response = await get(['v0.5', 'core', 'getting-started']);
    expect(response.status).toBe(200);
    expect(response.headers.get('Link')).toBe('<https://tenantry.dev/docs/core/getting-started>; rel="canonical"');

    const gone = await get(['v0.5', 'core', 'old-page']);
    expect(gone.headers.get('Link')).toBe('<https://tenantry.dev/docs>; rel="canonical"');
  });

  it("redirects a version the site does not publish to the latest page's Markdown, or the docs home's", async () => {
    for (const [slug, location] of [
      [['v0.4', 'core', 'getting-started'], '/docs/core/getting-started.md'],
      [['v0.6', 'core', 'getting-started'], '/docs/core/getting-started.md'],
      [['v0.4', 'core', 'old-page'], '/docs.md'],
    ] as const) {
      const response = await get([...slug]);
      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toBe(location);
      expect(await response.text()).toBe('');
    }
  });

  it('is not found for a missing page of a published version', async () => {
    for (const slug of [
      ['core', 'missing'],
      ['v0.5', 'core', 'missing'],
    ]) {
      const response = await get(slug);
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    }
  });
});
