import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docsProblem, foldersAt } from './docs-sources.mjs';

// A repository with one release tag for each case: complete, without docs, and without its changelog section.
let repository: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-C', repository, ...args], {
    stdio: 'pipe',
  });

function release(tag: string, files: Record<string, string>) {
  git('rm', '-rq', '--ignore-unmatch', '.');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repository, path, '..'), { recursive: true });
    writeFileSync(join(repository, path), text);
  }
  git('add', '--all');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', tag);
  git('tag', tag);
}

beforeAll(() => {
  repository = mkdtempSync(join(tmpdir(), 'docs-sources-'));
  git('init', '-q');
  const changelog = '# Changelog\n\n## [0.6.1] - 2026-10-10\n\n- A fix.\n\n## [0.6.0] - 2026-10-03\n';
  release('v0.6.1', {
    'docs/index.md': '# Docs',
    'CHANGELOG.md': changelog,
    'samples/A/a.cs': '',
    'samples/B/b.cs': '',
  });
  release('v0.6.2', { 'README.md': '# Readme', 'CHANGELOG.md': changelog.replace('0.6.1', '0.6.2') });
  release('v0.6.3', { 'docs/index.md': '# Docs', 'CHANGELOG.md': changelog });
  release('v0.4.0', { 'docs/index.md': '# Docs' });
});

afterAll(() => rmSync(repository, { recursive: true, force: true }));

describe('docs sources', () => {
  it('publishes a release with its docs and its changelog section', () => {
    expect(docsProblem(repository, 'core', 'v0.6.1')).toBeNull();
  });

  it('refuses a release without docs, or whose changelog has no section for it', () => {
    expect(docsProblem(repository, 'core', 'v0.6.2')).toBe('v0.6.2 has no docs folder');
    expect(docsProblem(repository, 'core', 'v0.6.3')).toBe("v0.6.3's CHANGELOG.md has no section for it");
  });

  it('needs no changelog for a Pro release before Pro published one', () => {
    expect(docsProblem(repository, 'pro', 'v0.4.0')).toBeNull();
    expect(docsProblem(repository, 'core', 'v0.4.0')).toBe('v0.4.0 has no CHANGELOG.md');
  });

  it('lists the folders in a tag’s folder', () => {
    expect(foldersAt(repository, 'v0.6.1', 'samples')).toEqual(['A', 'B']);
    expect(foldersAt(repository, 'v0.6.2', 'samples')).toEqual([]);
  });
});
