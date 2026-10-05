import 'server-only';
import { inflateRawSync } from 'node:zlib';
import type { DependencyGroup } from '@/server/db/package-feed';

/**
 * Reading a .nupkg (a zip archive) as the publish step needs it: its nuspec, and the optional release manifest
 * `tenantry-release.json` at its root. Only what NuGet's own packages use is supported: stored and deflated entries,
 * without zip64 or encryption.
 *
 * An archive can declare small sizes and inflate to gigabytes, so every entry is inflated with a ceiling on its output:
 * a file read here may inflate to MAX_METADATA_BYTES, and the whole package to MAX_INFLATED_BYTES (Pro's packages
 * inflate to a few MB). Beyond either, it is refused.
 */

export const MAX_METADATA_BYTES = 1024 * 1024;
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  declaredSize: number;
  localHeader: number;
}

/** The files at the root of the archive whose names `wanted` accepts, by name. */
export function readRootFiles(archive: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const entries = centralDirectory(bytes);

  // Declared sizes first, so an honest archive over the limits is refused before anything is inflated.
  const declared = entries.reduce((total, entry) => total + entry.declaredSize, 0);
  if (declared > MAX_INFLATED_BYTES) throw tooLarge('The package', MAX_INFLATED_BYTES);

  const files = new Map<string, string>();
  let budget = MAX_INFLATED_BYTES;

  for (const entry of entries) {
    const read = !entry.name.includes('/') && wanted(entry.name);
    if (read && entry.declaredSize > MAX_METADATA_BYTES)
      throw tooLarge(`The package's ${entry.name}`, MAX_METADATA_BYTES);

    const limit = read ? Math.min(MAX_METADATA_BYTES, budget) : budget;
    const content = inflate(bytes, entry, limit);
    budget -= content.length;
    if (read) files.set(entry.name, content.toString('utf8'));
  }

  return files;
}

function centralDirectory(bytes: Buffer): Entry[] {
  const end = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries: Entry[] = [];

  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('The package is not a valid zip archive');
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    entries.push({
      name: bytes.toString('utf8', offset + 46, offset + 46 + nameLength),
      method: bytes.readUInt16LE(offset + 10),
      compressedSize: bytes.readUInt32LE(offset + 20),
      declaredSize: bytes.readUInt32LE(offset + 24),
      localHeader: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }

  return entries;
}

// An entry's content, refusing one that inflates past `limit` bytes whatever its headers say.
function inflate(bytes: Buffer, entry: Entry, limit: number): Buffer {
  if (entry.localHeader + 30 > bytes.length) throw new Error('The package is not a valid zip archive');
  const start =
    entry.localHeader + 30 + bytes.readUInt16LE(entry.localHeader + 26) + bytes.readUInt16LE(entry.localHeader + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  // Name the limit that applies: a file read here has its own; past the package's budget, the package's.
  const ownLimit = limit === MAX_METADATA_BYTES;
  const what = ownLimit ? `The package's ${entry.name}` : 'The package';
  const reported = ownLimit ? MAX_METADATA_BYTES : MAX_INFLATED_BYTES;

  if (entry.method === 0) {
    if (data.length > limit) throw tooLarge(what, reported);
    return data;
  }
  if (entry.method !== 8) {
    throw new Error(`The package's ${entry.name} uses an unsupported compression method (${entry.method})`);
  }

  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(limit, 1) });
  } catch (error) {
    if (error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw tooLarge(what, reported);
    }
    throw error;
  }
}

function tooLarge(what: string, limit: number): Error {
  return new Error(`${what} is larger than ${Math.round(limit / 1024 / 1024)} MB uncompressed`);
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  // The record is 22 bytes, followed by a comment of up to 65535.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('The package is not a valid zip archive');
}

/** What the feed needs from a package's nuspec. */
export interface Nuspec {
  id: string;
  version: string;
  description: string | null;
  authors: string | null;
  dependencyGroups: DependencyGroup[];
}

/** Reads the nuspec's id, version, description, authors and dependencies. */
export function parseNuspec(xml: string): Nuspec {
  const metadata = element(xml, 'metadata') ?? '';
  const id = text(metadata, 'id');
  const version = text(metadata, 'version');
  if (!id || !version) throw new Error('The nuspec has no id or version');

  const dependencies = element(metadata, 'dependencies') ?? '';
  const groups = [...dependencies.matchAll(/<group\b([^>]*?)(?:\/>|>([\s\S]*?)<\/group>)/g)].map(
    ([, attributes, body]): DependencyGroup => {
      const targetFramework = attribute(attributes, 'targetFramework');
      return { ...(targetFramework ? { targetFramework } : {}), dependencies: dependencyList(body ?? '') };
    },
  );
  // A nuspec without groups lists its dependencies directly, for every framework.
  const ungrouped = groups.length === 0 ? dependencyList(dependencies) : [];

  return {
    id,
    version,
    description: text(metadata, 'description'),
    authors: text(metadata, 'authors'),
    dependencyGroups: groups.length > 0 ? groups : ungrouped.length > 0 ? [{ dependencies: ungrouped }] : [],
  };
}

function dependencyList(xml: string): DependencyGroup['dependencies'] {
  return [...xml.matchAll(/<dependency\b([^>]*?)\/?>/g)].map(([, attributes]) => {
    const range = attribute(attributes, 'version');
    return { id: attribute(attributes, 'id') ?? '', ...(range ? { range } : {}) };
  });
}

// The inner XML of the first element with this local name, ignoring any namespace prefix.
function element(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return match ? match[1] : null;
}

function text(xml: string, name: string): string | null {
  const inner = element(xml, name);
  return inner === null ? null : decode(inner.trim());
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes);
  return match ? decode(match[1]) : null;
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
