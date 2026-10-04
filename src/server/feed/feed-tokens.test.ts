import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { FeedDeps } from './deps';
import { createFeedToken, feedTokenFrom, hashFeedToken, revokeFeedToken } from './feed-tokens';
import { parseNuspec, readRootFiles } from './nupkg';
import { nuspec, zip } from '@/test/zip';

const basic = (credentials: string) =>
  new Request('https://sandbox.example.com/feed/v3/index.json', {
    headers: { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` },
  });

describe('feed tokens', () => {
  it('creates a random token, stores only its SHA-256 and a short prefix, and returns the token once', async () => {
    const createFeedTokenRecord = vi.fn(async () => 'token-id');
    const deps = { store: { createFeedTokenRecord } } as unknown as FeedDeps;

    const first = await createFeedToken('ctm_1', 'CI', deps);
    const second = await createFeedToken('ctm_1', 'Laptop', deps);

    expect(first.token).toMatch(/^tpf_[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.prefix).toBe(first.token.slice(0, 8));
    expect(createFeedTokenRecord).toHaveBeenCalledWith({
      customerId: 'ctm_1',
      name: 'CI',
      tokenHash: createHash('sha256').update(first.token).digest('hex'),
      prefix: first.prefix,
    });
    expect(JSON.stringify(createFeedTokenRecord.mock.calls)).not.toContain(first.token);
  });

  it('revokes one token of the customer', async () => {
    const revokeFeedTokenRecord = vi.fn(async () => true);

    await expect(
      revokeFeedToken('ctm_1', 'token-id', { store: { revokeFeedTokenRecord } } as unknown as FeedDeps),
    ).resolves.toBe(true);
    expect(revokeFeedTokenRecord).toHaveBeenCalledWith('ctm_1', 'token-id');
  });

  it('reads the token from basic authentication: the password, or the username with no password', () => {
    expect(feedTokenFrom(basic('nuget:tpf_secret'))).toBe('tpf_secret');
    expect(feedTokenFrom(basic('tpf_secret:'))).toBe('tpf_secret');
    expect(feedTokenFrom(basic('user:pass:with:colons'))).toBe('pass:with:colons');
    expect(feedTokenFrom(new Request('https://example.com', { headers: { authorization: 'Bearer x' } }))).toBeNull();
    expect(feedTokenFrom(new Request('https://example.com'))).toBeNull();
    expect(hashFeedToken('tpf_secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('reading a package', () => {
  it('reads the root nuspec and manifest from stored or deflated entries, ignoring nested files', () => {
    for (const store of [false, true]) {
      const files = readRootFiles(
        zip(
          {
            'Tenantry.Pro.nuspec': nuspec('Tenantry.Pro', '1.0.0'),
            'tenantry-release.json': '{"security":true}',
            'package/services/metadata/core-properties/x.psmdcp': '<x/>',
            'lib/net9.0/Tenantry.Pro.nuspec': 'not this one',
          },
          { store },
        ),
        (name) => name.endsWith('.nuspec') || name === 'tenantry-release.json',
      );
      expect([...files.keys()]).toEqual(['Tenantry.Pro.nuspec', 'tenantry-release.json']);
      expect(files.get('tenantry-release.json')).toBe('{"security":true}');
    }
  });

  it('refuses something that is not a zip archive', () => {
    expect(() => readRootFiles(new Uint8Array(100), () => true)).toThrow('not a valid zip archive');
  });

  it('parses the id, version, metadata and dependencies, grouped or not', () => {
    expect(
      parseNuspec(nuspec('Tenantry.Pro.EfCore', '1.4.0', { 'net9.0': { 'Tenantry.Pro': '[1.4.0, )' }, 'net10.0': {} })),
    ).toEqual({
      id: 'Tenantry.Pro.EfCore',
      version: '1.4.0',
      description: 'Multi-tenancy & more',
      authors: 'Tenantry',
      dependencyGroups: [
        { targetFramework: 'net9.0', dependencies: [{ id: 'Tenantry.Pro', range: '[1.4.0, )' }] },
        { targetFramework: 'net10.0', dependencies: [] },
      ],
    });

    expect(
      parseNuspec(
        '<package><metadata><id>Tenantry.Pro</id><version>1.0.0</version>' +
          '<dependencies><dependency id="Tenantry" version="1.0.0" /></dependencies></metadata></package>',
      ).dependencyGroups,
    ).toEqual([{ dependencies: [{ id: 'Tenantry', range: '1.0.0' }] }]);

    expect(() => parseNuspec('<package><metadata><id>X</id></metadata></package>')).toThrow('no id or version');
  });
});
