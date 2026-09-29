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
  reactCompiler: true,
  experimental: {
    // The Rust port of the React Compiler, which runs inside Turbopack instead of through Babel.
    turbopackRustReactCompiler: true,
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'tenantry.dev' }],
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
