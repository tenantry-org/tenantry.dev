import { deflateRawSync } from 'node:zlib';

/**
 * A minimal zip writer for tests that need a .nupkg: each file stored deflated (or stored, with `store`), without
 * CRCs, which the feed's reader (src/server/feed/nupkg.ts) does not check.
 */
export function zip(
  files: Record<string, string>,
  {
    store = false,
    declaredSize,
  }: {
    store?: boolean;
    /** The uncompressed size each entry's headers claim, if not its real one: an archive that lies about its sizes. */
    declaredSize?: number;
  } = {},
): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declaredSize ?? raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declaredSize ?? raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** A nuspec for a Tenantry Pro package, with one dependency group per framework given. */
export function nuspec(id: string, version: string, groups: Record<string, Record<string, string>> = {}): string {
  const dependencies = Object.entries(groups)
    .map(
      ([framework, deps]) =>
        `<group targetFramework="${framework}">` +
        Object.entries(deps)
          .map(
            ([dependency, range]) => `<dependency id="${dependency}" version="${range}" exclude="Build,Analyzers" />`,
          )
          .join('') +
        '</group>',
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">' +
    `<metadata><id>${id}</id><version>${version}</version><authors>Tenantry</authors>` +
    `<description>Multi-tenancy &amp; more</description><dependencies>${dependencies}</dependencies></metadata>` +
    '</package>'
  );
}
