#!/usr/bin/env node
/**
 * Content pipeline for the docs site.
 *
 * Ingests the markdown docs authored in the Tenantry Core and Pro repos into `content/docs`, one tree per docs
 * version, preparing them for the Fumadocs render step:
 *   - injects frontmatter (`title` from the first H1, which is then removed from the body),
 *   - derives a short `description` from the first paragraph,
 *   - rewrites relative `.md` links to clean docs paths (e.g. `(tenant-stores.md)` → `(tenant-stores)`),
 *   - adds the release line's part of each tag's CHANGELOG.md as the group's Changelog page (docs-changelog.mjs).
 *
 * The versions are listed in docs-versions.json (docs-versions.mjs), each with the release tags of Core's
 * repository and of the public tenantry-pro-docs repository (which each Pro release publishes to and tags; Vercel
 * cannot fetch the private Pro repository). Each tag's `docs/` folder is read from git, from partial clones kept
 * in `content/_src/{core,pro}` (gitignored), so the site shows what each release's packages do. The newest
 * version is written to `content/docs/(latest)` and served at /docs; each older one to `content/docs/v<version>`,
 * served at /docs/v<version>. Each is a Fumadocs root folder, which the sidebar offers as a version dropdown.
 * The list follows the release tags by itself (docs-versions-update.mjs and the docs-versions workflow).
 *
 * To preview unreleased docs locally, point CORE_DOCS_DIR / PRO_DOCS_DIR at a docs folder (for example
 * `PRO_DOCS_DIR=../tenantry-pro/docs pnpm dev`); it replaces the newest version's docs. Vercel and CI refuse these
 * overrides, and a missing source fails those builds instead of shipping without the docs.
 *
 * Run with: pnpm sync:docs
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { changelogPage } from './docs-changelog.mjs';
import { linkApiTypes, relativeLinks, rewriteLinks } from './docs-links.mjs';
import { basePath, compareLines, readVersions, versionProblems } from './docs-versions.mjs';
import { fileAt, hasTag, partialClone, REPOSITORIES } from './docs-sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');
const releaseBuild = Boolean(process.env.VERCEL || process.env.CI);

const groups = [
  {
    name: 'core',
    title: 'Tenantry Core',
    envVar: 'CORE_DOCS_DIR',
    repository: REPOSITORIES.core,
    // The release lines whose tags have a CHANGELOG.md: every Core tag has one at the repository's root.
    changelogSince: '0.1',
  },
  {
    name: 'pro',
    title: 'Tenantry Pro',
    envVar: 'PRO_DOCS_DIR',
    repository: REPOSITORIES.pro,
    // Pro's releases publish their CHANGELOG.md to tenantry-pro-docs from 0.5.0 (its scripts/publish-docs.sh).
    changelogSince: '0.5',
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
  'diagnostics',
  'access-control',
  'licensing',
  'testing',
  'aot-and-trimming',
  'compatibility',
  'troubleshooting',
  'changelog',
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

function toFrontmatter(raw, group, source, dir, context) {
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

  const linked = dir === 'api' ? body.join('\n') : linkApiTypes(body.join('\n'), context.apiTypes);
  const rewritten = rewriteLinks(linked, group, source, dir, context.base).trimStart();

  const yamlTitle = title.replaceAll('"', String.raw`\"`);
  const yamlDesc = description.replaceAll('"', String.raw`\"`);

  return `---\ntitle: "${yamlTitle}"\ndescription: "${yamlDesc}"\n---\n\n${rewritten}`;
}

// Writes one folder's markdown pages as MDX and returns their slugs (README.md becomes the folder's index).
function syncFolder(sourceDir, outDir, group, linkSource, dir, context) {
  const slugs = [];
  for (const file of readdirSync(sourceDir).filter((f) => f.endsWith('.md'))) {
    const slug = file.toLowerCase() === 'readme.md' ? 'index' : file.replace(/\.md$/, '');
    const content = toFrontmatter(readFileSync(join(sourceDir, file), 'utf8'), group.name, linkSource, dir, context);
    for (const link of relativeLinks(content))
      brokenLinks.push(`${context.version} ${group.name}/${dir ? `${dir}/` : ''}${file}: ${link}`);
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
const scratch = [];

function fail(message) {
  console.error(`sync-docs: ${message}`);
  process.exit(1);
}

// The docs folder of a tag, extracted to a temporary folder, with the tag's CHANGELOG.md beside it.
function docsAt(dir, tag) {
  if (!hasTag(dir, tag)) return null;
  const out = mkdtempSync(join(tmpdir(), 'tenantry-docs-'));
  scratch.push(out);
  const archive = execFileSync('git', ['-C', dir, 'archive', '--format=tar', tag, 'docs'], { maxBuffer: 1 << 28 }); // NOSONAR
  execFileSync('tar', ['-x', '-C', out], { input: archive }); // NOSONAR: tar from the build's PATH
  const changelog = fileAt(dir, tag, 'CHANGELOG.md');
  if (changelog !== null) writeFileSync(join(out, 'CHANGELOG.md'), changelog);
  return join(out, 'docs');
}

// The group's Changelog page, from the CHANGELOG.md beside its docs folder (the tag's, or a local preview's
// repository's), or null when there is none.
function syncChangelog(source, outDir, group, linkSource, context) {
  const file = join(source, '..', 'CHANGELOG.md');
  if (!existsSync(file)) {
    if (compareLines(context.version, group.changelogSince) < 0) return null;
    const message = `no CHANGELOG.md for ${context.version} ${group.name}.`;
    if (releaseBuild) fail(message);
    console.warn(`sync-docs: ${message}`);
    return null;
  }
  const page = changelogPage(readFileSync(file, 'utf8'), {
    product: group.title,
    line: context.version,
    fullChangelog: `${linkSource.repository}/blob/${linkSource.ref}/CHANGELOG.md`,
  });
  const content = toFrontmatter(page, group.name, linkSource, '', context);
  for (const link of relativeLinks(content)) brokenLinks.push(`${context.version} ${group.name}/CHANGELOG.md: ${link}`);
  writeFileSync(join(outDir, 'changelog.mdx'), content);
  total += 1;
  return 'changelog';
}

const versions = readVersions();
const problems = versionProblems(versions);
if (problems.length > 0) {
  const message = `docs-versions.json: ${problems.join(' ')}`;
  if (releaseBuild) fail(message);
  console.warn(`sync-docs: ${message}`);
}

const repositories = Object.fromEntries(
  groups.map((group) => [
    group.name,
    partialClone(group.name, versions.map((entry) => entry[group.name]).filter(Boolean)),
  ]),
);

const docsRoot = join(siteRoot, 'content', 'docs');
rmSync(docsRoot, { recursive: true, force: true });
mkdirSync(docsRoot, { recursive: true });

const folders = [];
for (const [index, entry] of versions.entries()) {
  const latest = index === 0;
  const base = basePath(versions, entry.version);
  const folder = latest ? '(latest)' : `v${entry.version}`;

  // Each group's docs for this version: a local preview folder for the newest, otherwise the tag's docs.
  const sources = {};
  for (const group of groups) {
    const override = latest && process.env[group.envVar];
    if (override) {
      if (releaseBuild) fail(`${group.envVar} is set; release builds publish only the pinned releases.`);
      const dir = resolve(override);
      sources[group.name] = existsSync(dir) ? { dir, ref: 'master' } : null;
      continue;
    }
    const tag = entry[group.name];
    const dir = tag && repositories[group.name] && docsAt(repositories[group.name], tag);
    sources[group.name] = dir ? { dir, ref: tag } : null;
  }

  const missing = groups
    .filter((group) => !sources[group.name])
    .map((group) => `${group.name} ${entry[group.name] ?? '(not pinned)'}`);
  if (missing.length > 0) {
    const message = `no docs for ${entry.version}: ${missing.join(', ')}.`;
    if (releaseBuild) fail(`${message} A build without these docs would publish none.`);
    console.warn(`sync-docs: ${message} Skipping.`);
    continue;
  }

  // Every type in both API references, so a guide's first mention of a type links to its page, across groups too.
  // A name defined twice (ServiceCollectionExtensions in two namespaces) is ambiguous and stays unlinked.
  const apiTypes = new Map();
  const ambiguous = new Set();
  for (const group of groups) {
    const apiSource = join(sources[group.name].dir, 'api');
    if (!existsSync(apiSource)) continue;
    for (const file of readdirSync(apiSource).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
      const name = readFileSync(join(apiSource, file), 'utf8').match(/^# `([A-Za-z_]\w*)/)?.[1];
      if (!name) continue;
      if (apiTypes.has(name)) ambiguous.add(name);
      apiTypes.set(name, `${base}/${group.name}/api/${file.replace(/\.md$/, '')}`);
    }
  }
  for (const name of ambiguous) apiTypes.delete(name);

  const context = { apiTypes, base, version: entry.version };
  const versionDir = join(docsRoot, folder);

  for (const group of groups) {
    const { dir: source, ref } = sources[group.name];
    const outDir = join(versionDir, group.name);
    const linkSource = { repository: group.repository, ref };
    mkdirSync(outDir, { recursive: true });

    const slugs = syncFolder(source, outDir, group, linkSource, '', context);
    const changelog = syncChangelog(source, outDir, group, linkSource, context);
    const pages = orderPages(changelog ? [...slugs, changelog] : slugs);

    // The API reference (docs/api, generated in each repository from its XML documentation comments) is its own
    // section, last in the group, with its pages grouped by namespace.
    const apiSource = join(source, 'api');
    if (existsSync(apiSource)) {
      const apiDir = join(outDir, 'api');
      mkdirSync(apiDir, { recursive: true });
      const apiSlugs = syncFolder(apiSource, apiDir, group, linkSource, 'api', context);
      writeFileSync(
        join(apiDir, 'meta.json'),
        JSON.stringify({ title: 'API reference', pages: apiPages(apiSource, apiSlugs) }, null, 2) + '\n',
      );
      pages.push('api');
    }

    writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ title: group.title, pages }, null, 2) + '\n');
    console.log(
      `sync-docs: ${entry.version} ${group.name} ← ${ref === 'master' ? source : ref} (${slugs.length} pages)`,
    );
  }

  // The version's landing page, and its folder as a root folder: the sidebar shows one version at a time and
  // offers the others in its dropdown.
  writeFileSync(
    join(versionDir, 'index.mdx'),
    `---
title: "Tenantry documentation"
description: "Guides for Tenantry Core (open source) and Tenantry Pro${latest ? '' : `, version ${entry.version}`}."
---

Tenantry is a production-grade multi-tenancy toolkit for .NET.

- **[Tenantry Core](${base}/core)** — open source: tenant resolution, and isolation in a shared database or a
  database per tenant.
- **[Tenantry Pro](${base}/pro)** — schema-per-tenant and mixed mode, provisioning, migration orchestration
  across tenant databases, tenant lifecycle, and background-job / message-bus integrations.

Use the sidebar to browse, or press <kbd>⌘</kbd> <kbd>K</kbd> to search.
`,
  );
  writeFileSync(
    join(versionDir, 'meta.json'),
    JSON.stringify(
      {
        title: `v${entry.version}`,
        description: latest ? 'Latest release' : `Core ${entry.core}, Pro ${entry.pro}`,
        root: true,
        pages: ['index', 'core', 'pro'],
      },
      null,
      2,
    ) + '\n',
  );
  folders.push(folder);
}

writeFileSync(join(docsRoot, 'meta.json'), JSON.stringify({ pages: folders }, null, 2) + '\n');
for (const dir of scratch) rmSync(dir, { recursive: true, force: true });

if (folders.length === 0) {
  if (releaseBuild) fail('no docs version could be synced.');
  console.warn('sync-docs: no docs version could be synced; /docs will be empty.');
}

if (brokenLinks.length > 0) {
  const message = `sync-docs: links that would resolve under the site and 404:\n  ${brokenLinks.join('\n  ')}`;
  if (releaseBuild) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}

console.log(`sync-docs: wrote ${total} files + nav to content/docs/ (${folders.join(', ')})`);
