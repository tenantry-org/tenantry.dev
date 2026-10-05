import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleFont } from './opengraph-image';

const CSS = `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/l/font?kit=abc) format('truetype');
}`;

describe('opengraph-image fonts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks Google Fonts for the weight and characters, and returns the TrueType file its CSS names', async () => {
    const font = new ArrayBuffer(4);
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://fonts.googleapis.com/') ? new Response(CSS) : new Response(font),
    );
    vi.stubGlobal('fetch', fetch);

    expect(await googleFont('JetBrains Mono', 400, 'tenantry.dev')).toEqual(font);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&text=tenantry.dev',
      'https://fonts.gstatic.com/l/font?kit=abc',
    ]);
  });

  it('fails the build when the CSS names no TrueType or OpenType file, which ImageResponse could not read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(CSS.replace("format('truetype')", "format('woff2')"))),
    );

    await expect(googleFont('Inter', 700, 'Multi-tenancy')).rejects.toThrow('no TrueType file for Inter 700');
  });
});
