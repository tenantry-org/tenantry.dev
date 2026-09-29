#!/usr/bin/env node
/**
 * Content pipeline for the docs site.
 *
 * Ingests the markdown docs authored in the Tenantry Core and Pro repos into `content/docs/{core,pro}`,
 * preparing them for the Fumadocs render step:
 *   - injects frontmatter (`title` from the first H1, which is then removed from the body),
 *   - derives a short `description` from the first paragraph,
 *   - rewrites relative `.md` links to clean docs paths (e.g. `(tenant-stores.md)` → `(tenant-stores)`).
 *
 * Sources, per group: the git submodules `content/_src/core/docs` and `content/_src/pro/docs`, which pin
 * released docs: Core's repository at a release tag, and for Pro the public tenantry-pro-docs repository,
 * which each Pro release publishes to and tags (Vercel cannot fetch the private Pro repository). Every
 * build, local ones included, reads the pinned docs, so the site shows what the released packages do.
 * `pnpm docs:pin <core|pro> <tag>` moves a pin; `pnpm docs:check` fails unless both are release tags.
 *
 * To preview unreleased docs locally, point CORE_DOCS_DIR / PRO_DOCS_DIR at a docs folder (for example
 * `PRO_DOCS_DIR=../tenantry-pro/docs pnpm dev`). Vercel and CI refuse these overrides, and a missing
 * source fails those builds instead of shipping without the docs.
 *
 * Run with: pnpm sync:docs
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { linkApiTypes, relativeLinks, rewriteLinks } from './docs-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');
const releaseBuild = Boolean(process.env.VERCEL || process.env.CI);

const groups = [
  {
    name: 'core',
    title: 'Tenantry Core',
    envVar: 'CORE_DOCS_DIR',
    submodule: 'content/_src/core/docs',
    repository: 'https://github.com/tenantry-org/tenantry-core',
  },
  {
    name: 'pro',
    title: 'Tenantry Pro',
    envVar: 'PRO_DOCS_DIR',
    submodule: 'content/_src/pro/docs',
    repository: 'https://github.com/tenantry-org/tenantry-pro-docs',
  },
];

// Preferred ordering for the in-group nav; anything not listed falls in alphabetically afterwards.
const PAGE_ORDER = [
  'index',
  'installation',
  'getting-started',
  'core-concepts',
  'tenant-resolution',
  'tenant-stores',
  'database-per-tenant',
  'schema-per-tenant',
  'mixed-mode',
  'database-providers',
  'efcore-integration',
  'aspnetcore-integration',
  'migration-orchestration',
  'tenant-lifecycle',
  'connection-string-encryption',
  'background-jobs',
  'non-http-hosts',
  'hangfire',
  'masstransit',
  'quartz',
  'rebus',
  'audit-logging',
  'health-checks',
  'telemetry',
  'access-control',
  'licensing',
  'aot-and-trimming',
  'compatibility',
  'troubleshooting',
];

function orderPages(slugs) {
  return [...slugs].sort((a, b) => {
    const ia = PAGE_ORDER.indexOf(a);
    const ib = PAGE_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

function resolveSource(group) {
  const override = process.env[group.envVar];
  if (override) {
    if (releaseBuild) {
      console.error(`sync-docs: ${group.envVar} is set; release builds publish only the pinned submodules.`);
      process.exit(1);
    }
    const dir = resolve(override);
    return existsSync(dir) ? dir : null;
  }

  const submodule = resolve(siteRoot, group.submodule);
  return existsSync(submodule) ? submodule : null;
}

// The commit the docs come from, so links into the repository (samples) match them: the submodule's
// checkout, or master for a local preview from another folder.
function sourceRef(dir) {
  try {
    const options = { encoding: 'utf8' };
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], options).trim(); // NOSONAR: git from the build's PATH
  } catch {
    return 'master';
  }
}

function toFrontmatter(raw, group, source, dir = '') {
  const lines = raw.split('\n');
  let title = '';
  const body = [];
  let removedH1 = false;

  for (const line of lines) {
    if (!removedH1 && line.startsWith('# ')) {
      // Code spans are for the page heading; the sidebar and <title> show plain text.
      title = line.slice(2).replaceAll('`', '').trim();
      removedH1 = true;
      continue;
    }
    body.push(line);
  }

  // Derive a clean meta description (used for SEO only — not rendered on the page) from the first
  // paragraph's first sentence, so search snippets aren't truncated mid-word.
  const firstParagraph = [];
  for (const line of body) {
    const text = line.trim();
    if (!text) {
      if (firstParagraph.length) break;
      continue;
    }
    // API reference pages open with a "Namespace: … · Package: …" line, which is not a description.
    if (/^(#|```|\||-|Namespace:)/.test(text)) {
      if (firstParagraph.length) break;
      continue;
    }
    firstParagraph.push(text);
  }
  const cleaned = firstParagraph
    .join(' ')
    .replace(/[`*[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const description = (cleaned.match(/^.*?\.(?:\s|$)/)?.[0] ?? cleaned).trim();

  const linked = dir === 'api' ? body.join('\n') : linkApiTypes(body.join('\n'), apiTypes);
  const rewritten = rewriteLinks(linked, group, source, dir).trimStart();

  const yamlTitle = title.replaceAll('"', String.raw`\"`);
  const yamlDesc = description.replaceAll('"', String.raw`\"`);

  return `---\ntitle: "${yamlTitle}"\ndescription: "${yamlDesc}"\n---\n\n${rewritten}`;
}

// Writes one folder's markdown pages as MDX and returns their slugs (README.md becomes the folder's index).
function syncFolder(sourceDir, outDir, group, linkSource, dir) {
  const slugs = [];
  for (const file of readdirSync(sourceDir).filter((f) => f.endsWith('.md'))) {
    const slug = file.toLowerCase() === 'readme.md' ? 'index' : file.replace(/\.md$/, '');
    const content = toFrontmatter(readFileSync(join(sourceDir, file), 'utf8'), group.name, linkSource, dir);
    for (const link of relativeLinks(content))
      brokenLinks.push(`${group.name}/${dir ? `${dir}/` : ''}${file}: ${link}`);
    writeFileSync(join(outDir, `${slug}.mdx`), content);
    slugs.push(slug);
    total += 1;
  }
  return slugs;
}

// The API reference's navigation: its index, then the types under a separator per namespace.
function apiPages(sourceDir, slugs) {
  const byNamespace = new Map();
  for (const slug of slugs.filter((slug) => slug !== 'index').sort()) {
    const text = readFileSync(join(sourceDir, `${slug}.md`), 'utf8');
    const namespace = text.match(/^Namespace: `([^`]+)`/m)?.[1] ?? 'Other';
    if (!byNamespace.has(namespace)) byNamespace.set(namespace, []);
    byNamespace.get(namespace).push(slug);
  }
  return [
    'index',
    ...[...byNamespace.keys()]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((namespace) => [`---${namespace}---`, ...byNamespace.get(namespace)]),
  ];
}

let total = 0;
const brokenLinks = [];

// Every type in both API references, so a guide's first mention of a type links to its page, across groups too.
// A name defined twice (ServiceCollectionExtensions in two namespaces) is ambiguous and stays unlinked.
const apiTypes = new Map();
const ambiguous = new Set();
for (const group of groups) {
  const apiSource = resolveSource(group) && join(resolveSource(group), 'api');
  if (!apiSource || !existsSync(apiSource)) continue;

  for (const file of readdirSync(apiSource).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const name = readFileSync(join(apiSource, file), 'utf8').match(/^# `([A-Za-z_]\w*)/)?.[1];
    if (!name) continue;
    if (apiTypes.has(name)) ambiguous.add(name);
    apiTypes.set(name, `/docs/${group.name}/api/${file.replace(/\.md$/, '')}`);
  }
}
for (const name of ambiguous) apiTypes.delete(name);

for (const group of groups) {
  const source = resolveSource(group);
  const outDir = join(siteRoot, 'content', 'docs', group.name);

  if (!source) {
    const message = `sync-docs: no docs for "${group.name}": run \`git submodule update --init\`${
      process.env[group.envVar] ? ` (or fix ${group.envVar})` : ''
    }.`;
    if (releaseBuild) {
      console.error(`${message} A build without these docs would publish none.`);
      process.exit(1);
    }
    console.warn(`${message} Skipping.`);
    continue;
  }

  const overridden = Boolean(process.env[group.envVar]);
  const linkSource = { repository: group.repository, ref: overridden ? 'master' : sourceRef(source) };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const slugs = syncFolder(source, outDir, group, linkSource, '');
  const pages = orderPages(slugs);

  // The API reference (docs/api, generated in each repository from its XML documentation comments) is its own
  // section, last in the group, with its pages grouped by namespace.
  const apiSource = join(source, 'api');
  if (existsSync(apiSource)) {
    const apiDir = join(outDir, 'api');
    mkdirSync(apiDir, { recursive: true });
    const apiSlugs = syncFolder(apiSource, apiDir, group, linkSource, 'api');
    writeFileSync(
      join(apiDir, 'meta.json'),
      JSON.stringify({ title: 'API reference', pages: apiPages(apiSource, apiSlugs) }, null, 2) + '\n',
    );
    pages.push('api');
  }

  writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ title: group.title, pages }, null, 2) + '\n');

  console.log(`sync-docs: ${group.name} ← ${source} (${slugs.length} pages)`);
}

// Root docs landing + top-level nav order.
const docsRoot = join(siteRoot, 'content', 'docs');
mkdirSync(docsRoot, { recursive: true });
writeFileSync(
  join(docsRoot, 'index.mdx'),
  `---
title: "Tenantry documentation"
description: "Guides for Tenantry Core (open source) and Tenantry Pro."
---

Tenantry is a production-grade multi-tenancy toolkit for .NET.

- **[Tenantry Core](/docs/core)** — open source: tenant resolution, and isolation in a shared database or a
  database per tenant.
- **[Tenantry Pro](/docs/pro)** — schema-per-tenant and mixed mode, provisioning, migration orchestration
  across tenant databases, tenant lifecycle, and background-job / message-bus integrations.

Use the sidebar to browse, or press <kbd>⌘</kbd> <kbd>K</kbd> to search.
`,
);
writeFileSync(join(docsRoot, 'meta.json'), JSON.stringify({ pages: ['index', 'core', 'pro'] }, null, 2) + '\n');

if (brokenLinks.length > 0) {
  const message = `sync-docs: links that would resolve under the site and 404:\n  ${brokenLinks.join('\n  ')}`;
  if (releaseBuild) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}

console.log(`sync-docs: wrote ${total} files + nav to content/docs/`);
