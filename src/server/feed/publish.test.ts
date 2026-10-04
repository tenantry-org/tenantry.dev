import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nuspec, zip } from '@/test/zip';
import type { FeedDeps, FeedStore } from './deps';
import { handlePublish } from './publish';

// What `dotnet nuget push` sends: a PUT of the .nupkg as multipart form data, with the key in X-NuGet-ApiKey.

const KEY = 'publish-key';

let store: { [K in keyof FeedStore]: ReturnType<typeof vi.fn> };
let deps: FeedDeps;
let releases: Map<string, { security: boolean; publishedAt: string }>;

beforeEach(() => {
  releases = new Map();
  store = {
    findFeedCustomer: vi.fn(),
    listFeedPackages: vi.fn(),
    readPackageNuspec: vi.fn(),
    createFeedTokenRecord: vi.fn(),
    revokeFeedTokenRecord: vi.fn(),
    packageExists: vi.fn(async () => false),
    // As pro_releases does: the first package records the release; a security patch needs its X.Y.0.
    ensureRelease: vi.fn(
      async (release: { version: string; minor: number; major: number; security: boolean; publishedAt: string }) => {
        if (release.security && !releases.has(`${release.major}.${release.minor}.0`)) {
          throw Object.assign(new Error('no X.Y.0'), { code: '23503' });
        }
        if (!releases.has(release.version)) releases.set(release.version, release);
        return { security: releases.get(release.version)!.security };
      },
    ),
    recordPackage: vi.fn(async () => true),
    recordedPackageId: vi.fn(async () => null),
    listReleases: vi.fn(async () =>
      [...releases].map(([version, release]) => {
        const [major, minor, patch] = version.split('.').map(Number);
        return { version, major, minor, patch, publishedAt: new Date(release.publishedAt) };
      }),
    ),
  };
  deps = {
    store: store as unknown as FeedStore,
    storage: { signedDownloadUrl: vi.fn(), storePackageFile: vi.fn(async () => undefined) },
    siteUrl: () => 'https://sandbox.example.com',
    feedPublishKeySha256: () => createHash('sha256').update(KEY).digest('hex'),
    now: () => new Date('2028-06-01T00:00:00Z'),
  };
});

function push(files: Record<string, string>, key: string | null = KEY) {
  const form = new FormData();
  form.append('package', new Blob([Buffer.from(zip(files))]), 'package.nupkg');
  const headers = new Headers();
  if (key !== null) headers.set('x-nuget-apikey', key);
  return handlePublish(
    new Request('https://sandbox.example.com/feed/v3/package', { method: 'PUT', body: form, headers }),
    deps,
  );
}

const efCore = {
  'Tenantry.Pro.EfCore.nuspec': nuspec('Tenantry.Pro.EfCore', '1.4.0', {
    'net9.0': { 'Tenantry.Pro': '[1.4.0, )', 'Microsoft.EntityFrameworkCore': '9.0.0' },
  }),
  'lib/net9.0/Tenantry.Pro.EfCore.dll': 'binary',
};

describe('handlePublish', () => {
  it('stores the package, records its release and its metadata, and answers 201', async () => {
    const response = await push(efCore);

    expect(response.status).toBe(201);
    const bytes = vi.mocked(deps.storage.storePackageFile).mock.calls[0][1];
    const path = `tenantry.pro.efcore/1.4.0/sha512-${createHash('sha512').update(bytes).digest('hex')}/tenantry.pro.efcore.1.4.0.nupkg`;
    expect(deps.storage.storePackageFile).toHaveBeenCalledWith(path, expect.any(Uint8Array));
    expect(store.ensureRelease).toHaveBeenCalledWith({
      version: '1.4.0',
      major: 1,
      minor: 4,
      patch: 0,
      publishedAt: '2028-06-01T00:00:00.000Z',
      security: false,
    });
    expect(store.recordPackage).toHaveBeenCalledWith({
      packageId: 'Tenantry.Pro.EfCore',
      version: '1.4.0',
      storagePath: path,
      size: bytes.byteLength,
      sha512: createHash('sha512').update(bytes).digest('base64'),
      nuspec: efCore['Tenantry.Pro.EfCore.nuspec'],
      description: 'Multi-tenancy & more',
      authors: 'Tenantry',
      dependencyGroups: [
        {
          targetFramework: 'net9.0',
          dependencies: [
            { id: 'Tenantry.Pro', range: '[1.4.0, )' },
            { id: 'Microsoft.EntityFrameworkCore', range: '9.0.0' },
          ],
        },
      ],
    });
  });

  it.each([
    ['no key', null],
    ['a wrong key', 'guess'],
  ])('refuses a push with %s', async (_, key) => {
    const response = await push(efCore, key);

    expect(response.status).toBe(403);
    expect(deps.storage.storePackageFile).not.toHaveBeenCalled();
  });

  it('refuses every push while no publish key is configured', async () => {
    deps.feedPublishKeySha256 = () => null;

    expect((await push(efCore)).status).toBe(403);
  });

  it('answers 409 for a package already published, which --skip-duplicate treats as done', async () => {
    store.packageExists.mockResolvedValue(true);

    expect((await push(efCore)).status).toBe(409);
    expect(deps.storage.storePackageFile).not.toHaveBeenCalled();
  });

  it.each([
    ['another package id', { 'Other.nuspec': nuspec('Other.Package', '1.0.0') }],
    ['a prerelease version', { 'Tenantry.Pro.nuspec': nuspec('Tenantry.Pro', '1.5.0-beta.1') }],
    ['no nuspec', { 'readme.md': 'hello' }],
  ])('refuses %s', async (_, files) => {
    expect((await push(files)).status).toBe(400);
  });

  it('dates the release from its manifest, and records a security patch once its X.Y.0 is published', async () => {
    const manifest = (security: boolean, releasedAt: string) => JSON.stringify({ security, releasedAt });
    deps.now = () => new Date('2027-11-21T00:00:00Z');

    expect(
      (
        await push({
          'Tenantry.Pro.nuspec': nuspec('Tenantry.Pro', '1.4.3'),
          'tenantry-release.json': manifest(true, '2028-03-15T12:00:00Z'),
        })
      ).status,
    ).toBe(400);

    await push({
      'Tenantry.Pro.nuspec': nuspec('Tenantry.Pro', '1.4.0'),
      'tenantry-release.json': manifest(false, '2027-11-20T12:00:00Z'),
    });
    expect(releases.get('1.4.0')?.publishedAt).toBe('2027-11-20T12:00:00.000Z');

    deps.now = () => new Date('2028-03-15T13:00:00Z');
    const patch = await push({
      'Tenantry.Pro.nuspec': nuspec('Tenantry.Pro', '1.4.3'),
      'tenantry-release.json': manifest(true, '2028-03-15T12:00:00Z'),
    });
    expect(patch.status).toBe(201);
    expect(releases.get('1.4.3')).toMatchObject({ security: true });
  });

  it('refuses a package whose manifest disagrees with its release about being a security patch', async () => {
    releases.set('1.4.0', { security: false, publishedAt: '2027-11-20T12:00:00Z' });
    releases.set('1.4.3', { security: false, publishedAt: '2028-03-15T12:00:00Z' });

    const response = await push({
      'Tenantry.Pro.EfCore.nuspec': nuspec('Tenantry.Pro.EfCore', '1.4.3'),
      'tenantry-release.json': JSON.stringify({ security: true }),
    });

    expect(response.status).toBe(409);
    expect(deps.storage.storePackageFile).not.toHaveBeenCalled();
  });
});

describe('archives that inflate beyond the limits', () => {
  it('refuses a package whose contents inflate past the limit with 400, storing nothing', async () => {
    const response = await push({ ...efCore, 'lib/net9.0/huge.dll': '\0'.repeat(40 * 1024 * 1024) });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('larger than');
    expect(deps.storage.storePackageFile).not.toHaveBeenCalled();
  });
});

describe('concurrent publishes of one version', () => {
  it('records the bytes that are stored at the recorded path, whichever push wins', async () => {
    // Storage that never replaces a stored file (Supabase's upload with upsert off). The first upload is the slower
    // one, so the second push records first: the interleaving that left a record's hash describing other bytes.
    const stored = new Map<string, Uint8Array>();
    let uploads = 0;
    deps.storage.storePackageFile = vi.fn(async (path: string, bytes: Uint8Array) => {
      if (!stored.has(path)) stored.set(path, bytes);
      const delay = uploads++ === 0 ? 20 : 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    });
    const records = new Map<string, { storagePath: string; sha512: string }>();
    store.recordPackage.mockImplementation(
      async (record: { packageId: string; version: string; storagePath: string; sha512: string }) => {
        const key = `${record.packageId.toLowerCase()}@${record.version}`;
        if (records.has(key)) return false;
        records.set(key, record);
        return true;
      },
    );

    const first = { ...efCore, 'lib/net9.0/Tenantry.Pro.EfCore.dll': 'first build' };
    const second = { ...efCore, 'lib/net9.0/Tenantry.Pro.EfCore.dll': 'second build' };
    const statuses = (await Promise.all([push(first), push(second)])).map((response) => response.status).sort();

    expect(statuses).toEqual([201, 409]);
    const [record] = records.values();
    const bytes = stored.get(record.storagePath)!;
    expect(createHash('sha512').update(bytes).digest('base64')).toBe(record.sha512);
  });
});

describe('release dates', () => {
  const dated = (version: string, releasedAt: string, security = false) =>
    push({
      'Tenantry.Pro.nuspec': nuspec('Tenantry.Pro', version),
      'tenantry-release.json': JSON.stringify({ releasedAt, security }),
    });

  it('refuses a release dated long before now, which would put it under every vested date', async () => {
    const response = await dated('9.9.0', '2000-01-01T00:00:00Z');

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('releasedAt');
    expect(store.ensureRelease).not.toHaveBeenCalled();
    expect((await dated('9.9.0', '2028-05-20T00:00:00Z')).status).toBe(400);
  });

  it('refuses a release dated in the future', async () => {
    expect((await dated('9.9.0', '2028-06-03T00:00:00Z')).status).toBe(400);
  });

  it('accepts a date within a few days before now, such as the tag date of a release published later', async () => {
    expect((await dated('9.9.0', '2028-05-30T00:00:00Z')).status).toBe(201);
  });

  it('refuses a date before the newest release of an earlier version', async () => {
    releases.set('9.8.0', { security: false, publishedAt: '2028-05-31T12:00:00Z' });
    // A patch of an older minor may come after a newer minor: only earlier versions bound it.
    releases.set('9.10.0', { security: false, publishedAt: '2028-05-31T18:00:00Z' });

    expect((await dated('9.9.0', '2028-05-31T00:00:00Z')).status).toBe(400);
    expect((await dated('9.9.0', '2028-05-31T13:00:00Z')).status).toBe(201);
  });

  it('dates a security patch as its minor by the release record, whatever its own date', async () => {
    releases.set('9.9.0', { security: false, publishedAt: '2028-05-30T00:00:00Z' });

    expect((await dated('9.9.1', '2028-05-31T00:00:00Z', true)).status).toBe(201);
    expect(store.ensureRelease).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: '9.9.1', security: true, publishedAt: '2028-05-31T00:00:00.000Z' }),
    );
  });
});

describe('package id casing', () => {
  it('refuses an id that differs only in case from one already published', async () => {
    store.recordedPackageId.mockImplementation(async (lowerId: string) =>
      lowerId === 'tenantry.pro.attack' ? 'Tenantry.Pro.Attack' : null,
    );

    const response = await push({ 'Tenantry.Pro.attack.nuspec': nuspec('Tenantry.Pro.attack', '1.4.0') });

    expect(response.status).toBe(409);
    expect(await response.text()).toContain('Tenantry.Pro.Attack');
    expect(deps.storage.storePackageFile).not.toHaveBeenCalled();
    expect((await push({ 'Tenantry.Pro.Attack.nuspec': nuspec('Tenantry.Pro.Attack', '1.4.1') })).status).toBe(201);
  });
});
