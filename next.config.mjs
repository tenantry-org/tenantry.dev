import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/**
 * The Content-Security-Policy for every page. It limits where a page can send data, so a script injected into a page
 * that shows the licence key or a new feed token cannot post them to another host: requests go only to the site,
 * Supabase and Paddle. Scripts load only from the site, Paddle, Turnstile and, in development, Vercel Analytics' debug
 * script; frames only from Paddle's checkout and Turnstile. Inline scripts stay allowed: Next.js inlines its own, and a
 * nonce would make every page render on request, which Partial Prerendering's static shells cannot do. One policy
 * covers the whole site because a page keeps its policy across client-side navigation, so every page the dashboard
 * links to runs under it too. The Vercel Toolbar, which preview deployments inject, is allowed there.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 */
export function contentSecurityPolicy(env = process.env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabase = URL.canParse(supabaseUrl) ? new URL(supabaseUrl).origin : null;
  const development = env.NODE_ENV === 'development';
  const toolbar = env.VERCEL_ENV === 'preview';
  const paddle = 'https://*.paddle.com';
  const turnstile = 'https://challenges.cloudflare.com';
  const sources = (...list) => list.filter(Boolean).join(' ');

  return [
    `script-src ${sources(
      "'self'",
      "'unsafe-inline'",
      development && "'unsafe-eval'",
      paddle,
      turnstile,
      development && 'https://va.vercel-scripts.com',
      toolbar && 'https://vercel.live',
    )}`,
    `connect-src ${sources("'self'", supabase, paddle, toolbar && 'https://vercel.live wss://ws-us3.pusher.com')}`,
    `frame-src ${sources(paddle, turnstile, toolbar && 'https://vercel.live')}`,
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
}

const securityHeaders = () => [
  // Force HTTPS for two years, including subdomains (enable before submitting to the HSTS preload list).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  // Nothing on the site uses these; a script injected into a page cannot ask for them either.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
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
        headers: securityHeaders(),
      },
    ];
  },
};

export default withMDX(nextConfig);
