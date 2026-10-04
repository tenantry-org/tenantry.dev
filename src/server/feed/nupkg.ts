import 'server-only';
import { inflateRawSync } from 'node:zlib';
import type { DependencyGroup } from '@/server/db/package-feed';

/**
 * Reading a .nupkg (a zip archive) as the publish step needs it: its nuspec, and the optional release manifest
 * `tenantry-release.json` at its root. Only what NuGet's own packages use is supported: stored and deflated entries,
 * without zip64 or encryption.
 */

/** The files at the root of the archive whose names `wanted` accepts, by name. */
export function readRootFiles(archive: Uint8Array, wanted: (name: string) => boolean): Map<string, string> {
  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = findEndOfCentralDirectory(bytes);
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const files = new Map<string, string>();

  for (let i = 0; i < entries; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('The package is not a valid zip archive');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeader = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.includes('/') || !wanted(name)) continue;

    const dataStart = localHeader + 30 + bytes.readUInt16LE(localHeader + 26) + bytes.readUInt16LE(localHeader + 28);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, data.toString('utf8'));
    else if (method === 8) files.set(name, inflateRawSync(data).toString('utf8'));
    else throw new Error(`The package's ${name} uses an unsupported compression method (${method})`);
  }

  return files;
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
