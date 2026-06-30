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
 * Source resolution (first that exists wins), per group:
 *   - env override: CORE_DOCS_DIR / PRO_DOCS_DIR
 *   - sibling checkout: ../tenantry-core/docs, ../tenantry-pro/docs   (local dev)
 *   - git submodule:    content/_src/core/docs, content/_src/pro/docs (CI / production)
 *
 * Run with: pnpm sync:docs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');

const groups = [
  {
    name: 'core',
    title: 'Tenantry Core',
    envVar: 'CORE_DOCS_DIR',
    candidates: ['../tenantry-core/docs', 'content/_src/core/docs'],
  },
  {
    name: 'pro',
    title: 'Tenantry Pro',
    envVar: 'PRO_DOCS_DIR',
    candidates: ['../tenantry-pro/docs', 'content/_src/pro/docs'],
  },
];

// Preferred ordering for the in-group nav; anything not listed falls in alphabetically afterwards.
const PAGE_ORDER = [
  'index',
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
  if (process.env[group.envVar]) return resolve(process.env[group.envVar]);
  for (const candidate of group.candidates) {
    const abs = resolve(siteRoot, candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function toFrontmatter(raw) {
  const lines = raw.split('\n');
  let title = '';
  const body = [];
  let removedH1 = false;

  for (const line of lines) {
    if (!removedH1 && line.startsWith('# ')) {
      title = line.slice(2).trim();
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
    if (text.startsWith('#') || text.startsWith('```') || text.startsWith('|') || text.startsWith('-')) {
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

  // Rewrite relative markdown links: (foo.md) and (foo.md#anchor) → (foo) / (foo#anchor)
  const rewritten = body
    .join('\n')
    .replace(/\]\(([^)]+?)\.md(#[^)]*)?\)/g, '](./$1$2)')
    .trimStart();

  const yamlTitle = title.replace(/"/g, '\\"');
  const yamlDesc = description.replace(/"/g, '\\"');

  return `---\ntitle: "${yamlTitle}"\ndescription: "${yamlDesc}"\n---\n\n${rewritten}`;
}

let total = 0;

for (const group of groups) {
  const source = resolveSource(group);
  const outDir = join(siteRoot, 'content', 'docs', group.name);

  if (!source) {
    console.warn(
      `sync-docs: no source found for "${group.name}" (set ${group.envVar} or add the submodule). Skipping.`,
    );
    continue;
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(source).filter((f) => f.endsWith('.md'));
  const slugs = [];
  for (const file of files) {
    // README.md → index.mdx so the group has a landing page.
    const slug = file.toLowerCase() === 'readme.md' ? 'index' : file.replace(/\.md$/, '');
    const content = toFrontmatter(readFileSync(join(source, file), 'utf8'));
    writeFileSync(join(outDir, `${slug}.mdx`), content);
    slugs.push(slug);
    total += 1;
  }

  // Per-group nav ordering + title.
  writeFileSync(
    join(outDir, 'meta.json'),
    JSON.stringify({ title: group.title, pages: orderPages(slugs) }, null, 2) + '\n',
  );

  console.log(`sync-docs: ${group.name} ← ${source} (${files.length} files)`);
}

// Root docs landing + top-level nav order.
const docsRoot = join(siteRoot, 'content', 'docs');
writeFileSync(
  join(docsRoot, 'index.mdx'),
  `---
title: "Tenantry documentation"
description: "Guides for Tenantry Core (open source) and Tenantry Pro."
---

Tenantry is a production-grade multi-tenancy toolkit for .NET.

- **[Tenantry Core](/docs/core)** — open-source, row-level (shared-database) multi-tenancy.
- **[Tenantry Pro](/docs/pro)** — database-per-tenant and schema-per-tenant isolation, provisioning,
  migration orchestration, tenant lifecycle, and background-job / message-bus integrations.

Use the sidebar to browse, or press <kbd>⌘</kbd> <kbd>K</kbd> to search.
`,
);
writeFileSync(join(docsRoot, 'meta.json'), JSON.stringify({ pages: ['index', 'core', 'pro'] }, null, 2) + '\n');

console.log(`sync-docs: wrote ${total} files + nav to content/docs/`);
