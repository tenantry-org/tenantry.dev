/**
 * Where the docs come from: Core's repository and the public tenantry-pro-docs repository (which each Pro release
 * publishes its docs to and tags; the Pro repository itself is private). Their release tags are read from partial
 * clones kept in `content/_src/{core,pro}` (gitignored), which fetch a file's contents only when it is read. Used by
 * sync-docs.mjs, docs-versions-update.mjs and the tests that compare the site with the released docs.
 */
import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const REPOSITORIES = {
  core: 'https://github.com/tenantry-org/tenantry-core',
  pro: 'https://github.com/tenantry-org/tenantry-pro-docs',
};

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
 * The partial clone of a group's repository (`core` or `pro`) with the given tags, fetching what it lacks, or null
 * when it cannot be reached and none exists yet. A clone that cannot be updated is still returned, with a warning.
 */
export function partialClone(group, tags) {
  const dir = join(sourcesRoot, group);
  try {
    if (!existsSync(join(dir, 'HEAD'))) {
      rmSync(dir, { recursive: true, force: true });
      git('clone', '--quiet', '--bare', '--filter=blob:none', '--no-tags', REPOSITORIES[group], dir);
    }
    const missing = tags.filter((tag) => !hasTag(dir, tag));
    if (missing.length > 0) {
      git(
        '-C',
        dir,
        'fetch',
        '--quiet',
        '--filter=blob:none',
        'origin',
        ...missing.map((t) => `+refs/tags/${t}:refs/tags/${t}`),
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
