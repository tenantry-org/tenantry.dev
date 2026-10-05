import { cacheLife } from 'next/cache';
import { ImageResponse } from 'next/og';
import { SHIELD, WORDMARK } from '@/components/brand/logo-paths';

// The social preview image of every page that sets none of its own, prerendered at build time and regenerated every 30
// days (the cacheLife('max') of its fonts). Its colours are the site's dark theme (src/styles/globals.css), and its
// fonts the site's own, Inter and JetBrains Mono, fetched from Google Fonts as next/font fetches them, but as TrueType,
// which ImageResponse reads (it cannot read WOFF2).

export const alt = 'Tenantry: multi-tenancy for ASP.NET Core and EF Core';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const COLOURS = {
  background: '#0b1120',
  foreground: '#f8fafc',
  muted: '#94a3b8',
  link: '#60a5fa',
};

const HEADLINE = ['Multi-tenancy', 'for ASP.NET Core and EF Core'] as const;
const SUBLINE = 'One call on your DbContext scopes queries and saves to the current tenant, and fails closed';
const ADDRESS = 'tenantry.dev';

// The full logo, as the header draws it (src/components/brand/logo.tsx), with the wordmark in the foreground colour.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 466 110">
<defs><clipPath id="c"><path d="${SHIELD}"/></clipPath>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B82F6"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs>
<g transform="translate(-10 0) scale(1.8)">
<g clip-path="url(#c)"><rect width="64" height="64" fill="url(#g)"/><rect x="32" width="32" height="64" fill="#1D4ED8"/></g>
<rect x="22" y="22" width="8" height="8" rx="1.5" fill="#DBEAFE" fill-opacity="0.5"/>
<rect x="34" y="22" width="8" height="8" rx="1.5" fill="#FFFFFF"/>
<rect x="22" y="34" width="8" height="8" rx="1.5" fill="#DBEAFE" fill-opacity="0.5"/>
<rect x="34" y="34" width="8" height="8" rx="1.5" fill="#DBEAFE" fill-opacity="0.5"/>
</g>
<path fill="${COLOURS.foreground}" d="${WORDMARK}"/>
</svg>`;

/** A font from Google Fonts as TrueType, cut to the characters `text` uses. */
export async function googleFont(family: string, weight: number, text: string): Promise<ArrayBuffer> {
  const query = `family=${family.replaceAll(' ', '+')}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await read(`https://fonts.googleapis.com/css2?${query}`);
  const url = /src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/.exec(await css.text())?.[1];
  if (!url) throw new Error(`Google Fonts returned no TrueType file for ${family} ${weight}`);
  return (await read(url)).arrayBuffer();
}

async function read(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response;
}

// Cached, so the image is prerendered at build: an uncached fetch would make the route render on every request.
async function fonts() {
  'use cache';
  cacheLife('max');
  return Promise.all([
    googleFont('Inter', 700, HEADLINE.join(' ')),
    googleFont('Inter', 400, SUBLINE),
    googleFont('JetBrains Mono', 400, ADDRESS),
  ]);
}

export default async function Image() {
  const [bold, regular, mono] = await fonts();

  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '95px 88px 0',
        background: COLOURS.background,
        fontFamily: 'Inter',
        overflow: 'hidden',
      }}
    >
      {/* The two rounded bands on the right, as on the earlier light image, in the theme's accent blue. */}
      <div
        style={{
          position: 'absolute',
          left: 700,
          top: -120,
          width: 620,
          height: 560,
          borderRadius: 96,
          background: 'rgba(37, 99, 235, 0.10)',
          transform: 'rotate(12deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 780,
          top: 420,
          width: 560,
          height: 400,
          borderRadius: 96,
          background: 'rgba(37, 99, 235, 0.16)',
          transform: 'rotate(12deg)',
        }}
      />
      <img
        src={`data:image/svg+xml;base64,${Buffer.from(LOGO).toString('base64')}`}
        width={559}
        height={132}
        alt={''}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginTop: 56,
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: COLOURS.foreground,
        }}
      >
        <span style={{ color: COLOURS.link }}>{HEADLINE[0]}</span>
        <span>{HEADLINE[1]}</span>
      </div>
      <div
        style={{ display: 'flex', marginTop: 24, maxWidth: 760, fontSize: 26, lineHeight: 1.45, color: COLOURS.muted }}
      >
        {SUBLINE}
      </div>
      <div style={{ display: 'flex', marginTop: 22, fontFamily: 'JetBrains Mono', fontSize: 22, color: COLOURS.link }}>
        {ADDRESS}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Inter', data: bold, weight: 700, style: 'normal' },
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'JetBrains Mono', data: mono, weight: 400, style: 'normal' },
      ],
    },
  );
}
