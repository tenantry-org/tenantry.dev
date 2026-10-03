#!/usr/bin/env node
/**
 * Copies the blog's published posts to dev.to, after each push to master (.github/workflows/devto.yml).
 *
 * The posts come from the production site's /blog/posts.json, so dev.to gets only what the site has published. It
 * waits until the site serves the posts of the commit it runs on, and no others: each published post in content/blog,
 * by the hash of its file (production deploys a commit only once its checks pass). Each post's dev.to article is found
 * by its canonical URL, the post's address on the site: one is created, published, when there is none, and updated
 * when its title, description or Markdown differ, or it is unpublished. An article whose canonical URL is a blog
 * address the site no longer publishes (the post was removed, or put back to draft) is unpublished; the account's
 * other articles are left alone. Run again, it changes nothing.
 *
 *   node scripts/devto-sync.mjs              wait for the site, then create and update the articles
 *   node scripts/devto-sync.mjs --dry-run    say what it would do, change nothing
 *
 * DEVTO_API_KEY is the key of the dev.to account the articles belong to (dev.to → Settings → Extensions); without one
 * it does nothing. DEVTO_ORGANIZATION_ID, if set, publishes new articles under that organisation. SITE_URL overrides
 * the site (https://tenantry.dev).
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const DEVTO = 'https://dev.to/api';

/** The published posts in a content/blog folder, by slug, with the hash of each file. */
export function publishedSources(dir) {
  const sources = new Map();
  for (const file of readdirSync(dir).filter((f) => /\.mdx?$/.test(f))) {
    const text = readFileSync(join(dir, file), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    // As YAML reads it: true in any of its spellings, and a comment after it.
    if (/^draft:\s*(?:true|True|TRUE)\s*(?:#.*)?$/m.test(frontmatter)) continue;
    sources.set(file.replace(/\.mdx?$/, ''), sourceHash(text));
  }
  return sources;
}

/** The hash /blog/posts.json gives each post's file. */
export function sourceHash(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The posts the site serves, once they are exactly the expected ones; null while it serves others, a post the commit
 * removed or made a draft among them.
 */
export function servedPosts(feed, expected) {
  if (feed.posts.length !== expected.size) return null;
  const served = new Map(feed.posts.map((post) => [post.slug, post]));
  for (const [slug, hash] of expected) if (served.get(slug)?.source !== hash) return null;
  return feed.posts;
}

/** What a post's dev.to article should hold. */
export function articleFor(post, organizationId) {
  return {
    title: post.title,
    description: post.description,
    tags: post.tags.join(', '),
    body_markdown: post.markdown,
    canonical_url: post.url,
    published: true,
    ...(organizationId ? { organization_id: Number(organizationId) } : {}),
  };
}

/**
 * What an update of a post's article sends: its article without the tags or the organisation. dev.to replaces the
 * tags an article is created with by its own, so they are set once, when the article is created, and left to dev.to;
 * the organisation too is chosen only then.
 */
export function updateFor(post) {
  const { tags: _tags, ...update } = articleFor(post);
  return update;
}

/** Whether an existing article differs from what an update would send, or is unpublished. */
export function differs(existing, update) {
  return (
    existing.published === false ||
    existing.title !== update.title ||
    (existing.description ?? '') !== update.description ||
    (existing.body_markdown ?? '').trim() !== update.body_markdown.trim()
  );
}

/**
 * The articles to create, update and unpublish, given the posts, the account's articles (with their Markdown) and the
 * site. Only articles whose canonical URL is under the site's /blog/ are unpublished.
 */
export function plan(posts, articles, organizationId, site) {
  const byUrl = new Map(articles.map((article) => [article.canonical_url, article]));
  const creates = [];
  const updates = [];
  for (const post of posts) {
    const existing = byUrl.get(post.url);
    if (!existing) creates.push({ post, article: articleFor(post, organizationId) });
    else if (differs(existing, updateFor(post))) updates.push({ post, id: existing.id, article: updateFor(post) });
  }
  const blog = new URL('/blog/', site).href;
  const published = new Set(posts.map((post) => post.url));
  const unpublishes = articles
    .filter(
      (article) =>
        article.published && article.canonical_url?.startsWith(blog) && !published.has(article.canonical_url),
    )
    .map((article) => ({ id: article.id, url: article.canonical_url, article: { published: false } }));
  return { creates, updates, unpublishes };
}

/** A dev.to API client over fetch, retrying when rate limited. */
export function devto(apiKey, fetchImpl = fetch, wait = sleep) {
  return async function request(method, path, body) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchImpl(`${DEVTO}${path}`, {
        method,
        headers: {
          'api-key': apiKey,
          accept: 'application/vnd.forem.api-v1+json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 429 && attempt < 5) {
        await wait(Number(response.headers.get('retry-after') ?? 30) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`dev.to ${method} ${path}: ${response.status} ${await response.text()}`);
      return response.json();
    }
  };
}

/** Every article of the account, published or not, each with its Markdown. */
export async function accountArticles(request) {
  const articles = [];
  for (let page = 1; ; page += 1) {
    const batch = await request('GET', `/articles/me/all?per_page=1000&page=${page}`);
    articles.push(...batch);
    if (batch.length < 1000) break;
  }
  return Promise.all(
    articles.map(async (article) =>
      article.body_markdown === undefined
        ? { ...article, ...(await request('GET', `/articles/${article.id}`)) }
        : article,
    ),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) {
    console.log('devto-sync: DEVTO_API_KEY is not set, so nothing is copied to dev.to.');
    return;
  }
  const site = process.env.SITE_URL || 'https://tenantry.dev';
  const expected = publishedSources(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'blog'));

  let posts = null;
  for (let attempt = 1; attempt <= 40 && !posts; attempt += 1) {
    const response = await fetch(`${site}/blog/posts.json`, { cache: 'no-store' });
    posts = response.ok ? servedPosts(await response.json(), expected) : null;
    if (!posts && attempt < 40) await sleep(30_000);
  }
  if (!posts)
    throw new Error(
      `${site} does not serve this commit's posts, and only them, after twenty minutes; the next push retries.`,
    );

  const request = devto(apiKey);
  const articles = await accountArticles(request);
  const { creates, updates, unpublishes } = plan(posts, articles, process.env.DEVTO_ORGANIZATION_ID, site);
  const changed = new Set([...creates, ...updates].map(({ post }) => post.url));
  for (const article of articles.filter((a) => posts.some((post) => post.url === a.canonical_url))) {
    if (!changed.has(article.canonical_url)) console.log(`devto-sync: up to date ${article.url}`);
  }
  for (const { post, article } of creates) {
    console.log(`devto-sync: ${dryRun ? 'would create' : 'creating'} ${post.url}`);
    if (!dryRun) console.log(`devto-sync: created ${(await request('POST', '/articles', { article })).url}`);
  }
  for (const { post, id, article } of updates) {
    console.log(`devto-sync: ${dryRun ? 'would update' : 'updating'} ${post.url} (article ${id})`);
    if (!dryRun) console.log(`devto-sync: updated ${(await request('PUT', `/articles/${id}`, { article })).url}`);
  }
  for (const { id, url, article } of unpublishes) {
    console.log(
      `devto-sync: ${dryRun ? 'would unpublish' : 'unpublishing'} article ${id}, whose post ${url} is not published`,
    );
    if (!dryRun) await request('PUT', `/articles/${id}`, { article });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`devto-sync: ${error.message}`);
    process.exit(1);
  });
}
