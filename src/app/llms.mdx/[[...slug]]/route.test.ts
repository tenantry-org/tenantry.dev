import { describe, expect, it, vi } from 'vitest';
import { GET, generateStaticParams } from './route';

vi.mock('../../../../docs-versions.json', () => ({
  default: { versions: [{ version: '0.6', core: 'v0.6.0', pro: 'v0.6.0' }] },
}));

// The docs as the sync wrote them: a page of the newest docs, and one under a version the site does not list.
const pages = [
  { url: '/docs/core/getting-started', slugs: ['core', 'getting-started'], title: 'Getting started' },
  { url: '/docs/v0.4/core', slugs: ['v0.4', 'core'], title: 'Tenantry Core' },
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
    expect(generateStaticParams()).toEqual([{ slug: ['core', 'getting-started'] }, { slug: ['v0.4', 'core'] }]);
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

  it('is not found for a page the site does not publish', async () => {
    for (const slug of [
      ['core', 'missing'],
      ['v0.4', 'core'],
    ]) {
      const response = await get(slug);
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    }
  });
});
