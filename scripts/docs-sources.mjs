/**
 * Where the docs come from: Core's repository and the public tenantry-pro-docs repository (which each Pro release
 * publishes its docs to and tags; the Pro repository itself is private). Their release tags are read from partial
 * clones kept in `content/_src/{core,pro}` (gitignored), which fetch a file's contents only when it is read. Used by
 * sync-docs.mjs and docs-versions-update.mjs.
 */
import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hasReleaseSection } from './docs-changelog.mjs';
import { compareLines, lineOf } from './docs-versions.mjs';

export const REPOSITORIES = {
  core: 'https://github.com/tenantry-org/tenantry-core',
  pro: 'https://github.com/tenantry-org/tenantry-pro-docs',
};

/**
 * The first release line whose tags have a CHANGELOG.md: every Core tag has one at the repository's root, and Pro's
 * releases publish theirs to tenantry-pro-docs from 0.5.0 (its scripts/publish-docs.sh).
 */
export const CHANGELOG_SINCE = { core: '0.1', pro: '0.5' };

const sourcesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'content', '_src');

export function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); // NOSONAR: git from the build's PATH
}

export function hasTag(dir, tag) {
  try {
    git('-C', dir, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The partial clone of a group's repository (`core` or `pro`) with the given tags, fetched again each time so that a
 * tag moved to corrected docs (tenantry-pro-docs' tags can be) is followed, or null when it cannot be reached and none
 * exists yet. A clone that cannot be updated is still returned, with a warning.
 */
export function partialClone(group, tags) {
  const dir = join(sourcesRoot, group);
  try {
    if (!existsSync(join(dir, 'HEAD'))) {
      rmSync(dir, { recursive: true, force: true });
      git('clone', '--quiet', '--bare', '--filter=blob:none', '--no-tags', REPOSITORIES[group], dir);
    }
    if (tags.length > 0) {
      git(
        '-C',
        dir,
        'fetch',
        '--quiet',
        '--filter=blob:none',
        'origin',
        ...tags.map((t) => `+refs/tags/${t}:refs/tags/${t}`),
      );
    }
  } catch (error) {
    console.warn(
      `docs-sources: could not update ${REPOSITORIES[group]}: ${String(error.stderr || error.message).trim()}`,
    );
  }
  return existsSync(join(dir, 'HEAD')) ? dir : null;
}

/** A file as a tag has it (`docs/installation.md`), or null when the tag or the file does not exist. */
export function fileAt(dir, tag, path) {
  if (!hasTag(dir, tag)) return null;
  try {
    return git('-C', dir, 'show', `${tag}:${path}`);
  } catch {
    return null;
  }
}

/** The folders in a tag's folder (`samples`), or an empty list when it has none. */
export function foldersAt(dir, tag, path) {
  try {
    return git('-C', dir, 'ls-tree', '-d', '--name-only', `${tag}:${path}`).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Why the site cannot publish a release's docs from a group's tag (`core` or `pro`), or null when it can: the tag must
 * have a docs folder, and from CHANGELOG_SINCE on a CHANGELOG.md with the release's own section, which the
 * Changelog page shows. The tag must be in the clone (hasTag).
 */
export function docsProblem(dir, group, tag) {
  if (foldersAt(dir, tag, '').every((folder) => folder !== 'docs')) return `${tag} has no docs folder`;
  if (compareLines(lineOf(tag), CHANGELOG_SINCE[group]) < 0) return null;
  const changelog = fileAt(dir, tag, 'CHANGELOG.md');
  if (changelog === null) return `${tag} has no CHANGELOG.md`;
  if (!hasReleaseSection(changelog, tag)) return `${tag}'s CHANGELOG.md has no section for it`;
  return null;
}
