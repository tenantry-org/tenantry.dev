# tenantry-site

The Tenantry website, documentation, and commercial customer portal — a [Next.js](https://nextjs.org/)
16 app (App Router, React 19.2, Tailwind v4) that handles marketing, pricing, docs, and the
purchase → entitlement → access pipeline for **Tenantry Pro**.

## What it does

- **Marketing + pricing** — landing page and Paddle-powered pricing for Tenantry Pro.
- **Docs** (`/docs`) — full searchable documentation via [Fumadocs](https://fumadocs.dev), sourced
  from the `tenantry-core` and `tenantry-pro` repos (see [Docs pipeline](#docs-pipeline)).
- **Commercial backend** — Paddle webhooks drive Supabase entitlements, an ES256 licence issuer, and
  GitHub provisioning (org/team membership = private package-feed access).
- **Customer portal** (`/dashboard`) — subscription status, "Connect GitHub", licence-key download,
  and NuGet feed setup at `/dashboard/pro`.

## Architecture

```
Paddle (merchant of record) ──webhook──▶ /api/webhook ──▶ entitlements + licence + GitHub grant
                                                              (Supabase, service role)
customer ─▶ /dashboard/pro ─▶ Connect GitHub ─▶ github_links + team membership ─▶ private package feed
cron ─▶ /api/reconcile ─▶ reconcile access vs entitlements
```

Key code:

- `src/utils/licensing/` — ES256 (DER) licence issuer.
- `src/utils/paddle/process-webhook.ts` — subscription → entitlement/licence/access + lifecycle email.
- `src/utils/github/` — App-authenticated provisioning + link sync.
- `src/utils/entitlements/` — entitlement/licence data access + reconciliation.
- `src/utils/email/` — transactional onboarding/lifecycle email (Resend).
- `supabase/migrations/` — schema + RLS + webhook idempotency.

## Develop

```bash
pnpm install
pnpm dev        # runs sync:docs, then next dev
```

`pnpm test` runs lint + Prettier + `tsc` + Vitest. Copy [`.env.example`](.env.example) to `.env.local`
and fill in the values for the services you need.

## Docs pipeline

`/docs` is rendered by Fumadocs from MDX under `content/docs/` (gitignored, generated). `pnpm sync:docs`
(`scripts/sync-docs.mjs`) reads the source markdown — from sibling checkouts (`../tenantry-core/docs`,
`../tenantry-pro/docs`) in dev, or git submodules at `content/_src/{core,pro}` in CI — and transforms
it (injects frontmatter, rewrites links, `.md`→`.mdx`). It runs automatically before `dev`/`build`.

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables (Supabase, Paddle,
GitHub App, licensing, and email). Operational runbooks (provisioning, key rotation, reconcile) are
maintained privately by the maintainers.
