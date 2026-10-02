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
- `src/utils/entitlements/` — data access and reconciliation. With the webhook inbox (`src/utils/webhooks/inbox.ts`),
  the service-role store (`entitlements-store.ts`) and the dashboard's read model (`get-entitlement.ts`) are the
  only modules that query the database (ESLint enforces it).
- `src/utils/email/` — transactional onboarding/lifecycle email (Resend).
- `src/utils/supabase/` — `createUserClient` (the signed-in user's session; RLS applies) and
  `createServiceRoleClient` (bypasses RLS; only server modules under `src/utils` import it), both typed by
  `database.types.ts`, which is generated from the migrations. The server's
  modules (Supabase, licensing, GitHub, Paddle, email, webhooks, config) import `server-only`, so a client
  component that pulls one in fails the build.
- `supabase/migrations/` — schema + RLS + webhook idempotency.

## Develop

```bash
pnpm install
pnpm dev        # runs sync:docs, then next dev
```

`pnpm test` runs lint + Prettier + `tsc` + Vitest. CI (`.github/workflows/test.yml`) runs it, `pnpm build` and the
database tests on every push to master and every pull request; production deployments wait for those jobs (Vercel
Deployment Checks). Copy [`.env.example`](.env.example) to `.env.local`
and fill in the values for the services you need.

After changing a migration, rebuild the local database from the migrations, as CI does (`supabase db start` if it is
not running, then `supabase db reset`, which discards its data), and run `pnpm db:types`. CI regenerates the types
from the migrations and fails if the committed file differs, so generate them with the Supabase CLI version its
database job pins.

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

- **Releases publish their docs by themselves.** The versions are worked out from the release tags: a line is
  listed once both Core and Pro have a stable release in it, with the newest patch of each. The `docs-versions`
  workflow checks hourly (or on demand), commits any change to master and staging, which redeploys the site, and runs
  the test workflow on the commit, since its own pushes start none.
  `pnpm docs:update` does the same locally; `pnpm docs:check` fails unless the file matches the tags.
- **The Pro access page's install snippets follow a Pro release line**, `PRO_RELEASE_LINE` in
  `src/utils/pro/install-snippets.ts`. Once that line's docs are published, the tests compare the snippets with its
  installation guide, and they fail when a newer line is published. So the docs of a Pro release that starts a line
  or changes the installation guide reach production only with matching snippets: until then the test workflow
  fails on master, and production deployments, these docs' and any other change's, wait. For a new line, update the
  snippets before the release: the tests accept the next line; for a patch that changes the guide, once its docs are
  listed.
- **Preview unreleased docs** locally with an override, for example
  `PRO_DOCS_DIR=../tenantry-pro/docs pnpm dev` (or `CORE_DOCS_DIR`); it replaces the newest version's docs.
  Vercel and CI builds refuse overrides.

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables (Supabase, Paddle,
GitHub App, licensing, and email). Operational runbooks (provisioning, key rotation, reconcile) are
maintained privately by the maintainers.
