import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const securityHeaders = [
  // Force HTTPS for two years, including subdomains (enable before submitting to the HSTS preload list).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pages prerender a static shell and stream their dynamic parts into Suspense boundaries (Partial Prerendering).
  cacheComponents: true,
  // The blog's posts.json reads the posts' files when it is requested (src/app/blog/posts.json/route.ts), so they
  // ship with its function.
  outputFileTracingIncludes: { '/blog/posts.json': ['./content/blog/**/*'] },
  reactCompiler: true,
  experimental: {
    // The Rust port of the React Compiler, which runs inside Turbopack instead of through Babel.
    turbopackRustReactCompiler: true,
  },
  // Each docs page's Markdown at its URL with `.md` on the end (src/app/llms.mdx), as Fumadocs serves it.
  async rewrites() {
    return [
      { source: '/docs.md', destination: '/llms.mdx' },
      { source: '/docs/:path*.md', destination: '/llms.mdx/:path*' },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withMDX(nextConfig);
