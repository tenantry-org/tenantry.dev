import { describe, expect, it } from 'vitest';
import { crossPostMarkdown, withAbsoluteLinks } from './blog-markdown';

describe('withAbsoluteLinks', () => {
  it('makes site paths absolute in links, images and link definitions', () => {
    expect(
      withAbsoluteLinks('See [the docs](/docs/core#stores), ![diagram](/blog/a.png) and [ref].\n\n[ref]: /pro'),
    ).toBe(
      'See [the docs](https://tenantry.dev/docs/core#stores), ![diagram](https://tenantry.dev/blog/a.png) and [ref].' +
        '\n\n[ref]: https://tenantry.dev/pro',
    );
  });

  it('leaves absolute URLs, anchors and code blocks alone', () => {
    const untouched = '[GitHub](https://github.com/x) [below](#setup)\n\n```csharp\nvar link = "[x](/y)";\n```';
    expect(withAbsoluteLinks(untouched)).toBe(untouched);
  });
});

describe('crossPostMarkdown', () => {
  it('adds the checked versions first and the next step last, as the page shows them', () => {
    const post = { versions: 'Tenantry 0.5', next: { label: 'Get started', href: '/docs/core/getting-started' } };
    expect(crossPostMarkdown(post, 'Body [docs](/docs).\n')).toBe(
      '*Checked against Tenantry 0.5.*\n\nBody [docs](https://tenantry.dev/docs).\n\n' +
        '**[Get started](https://tenantry.dev/docs/core/getting-started)**',
    );
  });
});
