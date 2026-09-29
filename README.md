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
(`scripts/sync-docs.mjs`) runs before `dev`/`build`: it reads each docs version's markdown from git and transforms
it (injects frontmatter, rewrites links, `.md`→`.mdx`).

The versions are listed in [`docs-versions.json`](docs-versions.json), newest first: each release line (`0.4`)
with the Core and Pro release tags its docs come from (Core's repository, and the public `tenantry-pro-docs`
repository, which each Pro release publishes and tags). The newest is served at `/docs`, each older one at
`/docs/v<version>` with a notice pointing to the latest; the sidebar has a version dropdown and search covers
the version being read. The tags are read from partial clones kept in `content/_src/` (gitignored), so every
build, local ones included, shows what the released packages do.

- **On each release**, pin its tags and commit `docs-versions.json`: `pnpm docs:pin core v0.5.0` and
  `pnpm docs:pin pro v0.5.0` (a Pro tag exists once that release's publish-docs job has run). A patch moves its
  line's tag; a new minor adds a version, and the previous one moves under `/docs/v<version>`.
- **`pnpm docs:check`** fails unless every version has both tags and they exist.
- **Preview unreleased docs** locally with an override, for example
  `PRO_DOCS_DIR=../tenantry-pro/docs pnpm dev` (or `CORE_DOCS_DIR`); it replaces the newest version's docs.
  Vercel and CI builds refuse overrides.

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables (Supabase, Paddle,
GitHub App, licensing, and email). Operational runbooks (provisioning, key rotation, reconcile) are
maintained privately by the maintainers.
