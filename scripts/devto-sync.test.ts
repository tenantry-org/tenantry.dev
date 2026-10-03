import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { accountArticles, articleFor, devto, plan, publishedSources, servedPosts, sourceHash } from './devto-sync.mjs';

const post = {
  slug: 'migrations',
  url: 'https://tenantry.dev/blog/migrations',
  title: 'Running EF Core migrations across tenant databases',
  description: 'One call.',
  tags: ['dotnet', 'efcore'],
  markdown: '*Checked against Tenantry 0.5.*\n\nBody.',
  source: 'abc',
};
const existing = {
  id: 7,
  canonical_url: post.url,
  title: post.title,
  description: post.description,
  tag_list: ['efcore', 'dotnet'],
  body_markdown: `${post.markdown}\n`,
};

describe('publishedSources', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('hashes the published posts and leaves drafts out', () => {
    dir = mkdtempSync(join(tmpdir(), 'blog-'));
    const published = '---\ntitle: A\ndraft: false\n---\n\nBody.\n';
    writeFileSync(join(dir, 'a.md'), published);
    writeFileSync(join(dir, 'b.md'), '---\ntitle: B\ndraft: true\n---\n\nBody.\n');
    writeFileSync(join(dir, 'c.md'), '---\ntitle: C\ndraft: True # until it is ready\n---\n\nBody.\n');
    writeFileSync(join(dir, 'notes.txt'), 'not a post');
    expect(publishedSources(dir)).toEqual(new Map([['a', sourceHash(published)]]));
  });
});

describe('servedPosts', () => {
  it('waits until the site serves every published post of the commit, as the commit has it', () => {
    const feed = { posts: [post] };
    expect(servedPosts(feed, new Map([['migrations', 'abc']]))).toEqual([post]);
    expect(servedPosts(feed, new Map([['migrations', 'changed']]))).toBeNull();
    expect(servedPosts(feed, new Map([['another', 'def']]))).toBeNull();
  });
});

describe('plan', () => {
  it('creates a published article for a post without one, under the organisation if given', () => {
    expect(plan([post], [], '42')).toEqual({
      creates: [
        {
          post,
          article: {
            title: post.title,
            description: post.description,
            tags: 'dotnet, efcore',
            body_markdown: post.markdown,
            canonical_url: post.url,
            published: true,
            organization_id: 42,
          },
        },
      ],
      updates: [],
    });
  });

  it('leaves an article that matches its post, whatever the order of its tags', () => {
    expect(plan([post], [existing], undefined)).toEqual({ creates: [], updates: [] });
  });

  it('updates an article whose post changed, without moving it to an organisation', () => {
    const changed = { ...post, markdown: 'New body.' };
    expect(plan([changed], [existing], '42')).toEqual({
      creates: [],
      updates: [{ post: changed, id: 7, article: { ...articleFor(changed, undefined) } }],
    });
  });
});

describe('dev.to requests', () => {
  it('reads every page of the account, fetching the Markdown an article lacks', async () => {
    const calls: string[] = [];
    const full = Array.from({ length: 1000 }, (_, id) => ({ id, body_markdown: '' }));
    const request = async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (path.endsWith('&page=1')) return full;
      if (path.endsWith('&page=2')) return [{ id: 1001 }];
      return { id: 1001, body_markdown: 'Body.' };
    };
    const articles = await accountArticles(request);
    expect(articles).toHaveLength(1001);
    expect(articles.at(-1)).toEqual({ id: 1001, body_markdown: 'Body.' });
    expect(calls).toEqual([
      'GET /articles/me/all?per_page=1000&page=1',
      'GET /articles/me/all?per_page=1000&page=2',
      'GET /articles/1001',
    ]);
  });

  it('sends the key, retries when rate limited and fails on an error', async () => {
    const responses = [
      new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
      new Response(JSON.stringify({ id: 9 }), { status: 201 }),
      new Response('bad', { status: 422 }),
    ];
    const seen: RequestInit[] = [];
    const waits: number[] = [];
    const request = devto(
      'key',
      (async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push(init ?? {});
        return responses.shift()!;
      }) as typeof fetch,
      async (ms: number) => {
        waits.push(ms);
      },
    );

    expect(await request('POST', '/articles', { article: {} })).toEqual({ id: 9 });
    expect(waits).toEqual([2000]);
    expect(seen[0].headers).toMatchObject({ 'api-key': 'key', 'content-type': 'application/json' });
    await expect(request('PUT', '/articles/9', { article: {} })).rejects.toThrow('dev.to PUT /articles/9: 422 bad');
  });
});
