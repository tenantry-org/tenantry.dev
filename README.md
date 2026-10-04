# tenantry-site

The Tenantry website, documentation, and commercial customer portal — a [Next.js](https://nextjs.org/)
16 app (App Router, React 19.3, Tailwind v4) that handles marketing, pricing, docs, and the
purchase → entitlement → access pipeline for **Tenantry Pro**.

## What it does

- **Marketing + pricing** — landing page and Paddle-powered pricing for Tenantry Pro.
- **Docs** (`/docs`) — full searchable documentation via [Fumadocs](https://fumadocs.dev), sourced
  from the `tenantry-core` and `tenantry-pro` repos (see [Docs pipeline](#docs-pipeline)).
- **Commercial backend** — Paddle webhooks drive Supabase entitlements, an ES256 licence issuer, and
  GitHub provisioning (org/team membership = private package-feed access).
- **Customer portal** (`/dashboard/pro`) — Access ("Connect GitHub" and the licence key), Install (setting up the
  private NuGet feed) and Billing (the subscriptions, with invoices and the payment method in Paddle's portal).

## Architecture

```
Paddle (merchant of record) ──webhook──▶ /api/webhook ──▶ subscriptions + payments ─▶ access, entitlement,
                                                              licence + GitHub grant
                                                              (Supabase, service role)
customer ─▶ /dashboard/pro ─▶ Connect GitHub ─▶ github_links + team membership ─▶ private package feed
cron ─▶ /api/reconcile ─▶ recompute access and entitlement, retry what failed
```

Pro's packages are on GitHub Packages, reached through membership of a team in the customers' GitHub org, and the
site and Pro's docs describe that. The site now also serves its own NuGet feed (`/feed/v3/index.json`,
`src/server/feed`), which shows each customer the releases they may use, including after a lapse those their
perpetual licence covers. It replaces GitHub Packages, and the GitHub team provisioning goes with it, before
subscriptions go on sale.

Key code is in `src/server`, in layers whose imports point only down this list (ESLint enforces it):

- `feed/` — Tenantry Pro's NuGet v3 feed (`/feed/v3/index.json`, routed by `src/app/feed/v3`): each customer's feed
  tokens, the read resources filtered to the releases they may use, and publishing for the release workflow.
  `scripts/feed-e2e.sh` runs a real `dotnet restore` against it.
- `billing/` — the rules and services: what a customer may access now and owns for good, computed from their
  subscriptions and payments (`entitlement-policy.ts`, with the Paddle behaviour it assumes in
  `paddle-assumptions.ts`); storing that and keeping their GitHub membership, licence and emails in line with it
  (`customer-access.ts`); applying Paddle's notifications (`apply-paddle-event.ts`); linking a GitHub account (`sync-github-link.ts`); the reconcile
  run; and the Pro pages' read models, one per page, each reading only what its page shows (`pro-pages.ts`).
- `jobs/` — the worker that runs each customer's jobs (Paddle events and reconciles) one at a time and in order, and
  the per-customer leases.
- `integrations/` — Paddle, GitHub team provisioning (a GitHub App), email (Resend) and the licence issuer.
- `db/` — `createUserClient` (the signed-in user's session; RLS applies) and `createServiceRoleClient` (bypasses
  RLS), and the only modules that query the database: the billing tables' store, the customer jobs and the
  dashboard's reads. The clients are typed by `src/lib/supabase/database.types.ts`, which is generated from the
  migrations.
- `config/` — the server's configuration, `serverConfig()`: every setting, validated when the server starts.

Modules in `src/server` import `server-only` (except `db/update-session.ts`, which the proxy runs), so a client
component that pulls one in fails the build. The services that change a customer's access (`customer-access.ts`,
`reconcile-customer.ts`, `apply-paddle-event.ts`, `sync-github-link.ts`) take what they use from the layers below as
their last argument (`billing/deps.ts`), defaulting to the real modules, so their tests pass an in-memory billing store
and fakes instead of replacing modules; the read models are tested against a fake Supabase client. `src/lib` holds
helpers for both sides, and `src/test` the fakes the tests share.

The database schema, with its RLS policies and functions, starts with
`supabase/migrations/20261002120000_baseline.sql`; later changes are migrations after it. Their tests are in
`supabase/tests/database/`, and a migration that moves data is tested against rows of the schema before it in
`supabase/migration-tests/` (`pnpm test:migrations`).

## Develop

```bash
pnpm install
pnpm dev        # runs sync:docs, then next dev
```

`pnpm test` runs lint + Prettier + `tsc` + Vitest. CI (`.github/workflows/test.yml`) runs it, `pnpm build` and the
database tests on every push to master and every pull request; production deployments wait for those jobs (Vercel
Deployment Checks). Copy [`.env.example`](.env.example) to `.env.local`
and fill in the values for the services you need.

**TypeScript is installed twice, under aliases.** `@typescript/native` is TypeScript 7 (`npm:typescript@^7`): its
`tsc` is what `pnpm typecheck` runs, in `pnpm test` and CI. `typescript` is TypeScript 6
(`npm:@typescript/typescript6@^6`) for typescript-eslint, which needs TypeScript 6's compiler API: its supported range
ends before 6.1, and TypeScript 7.0 has only a new, unstable API. Next's build runs the `typescript` package's own
compiler (`tsc6`), so the build type-checks with TypeScript 6 and `pnpm typecheck` with 7, and code must pass both.
Dependabot skips aliased packages, so these two are updated by hand. Once typescript-eslint supports TypeScript 7, drop
the aliases: `typescript` becomes TypeScript 7 itself, and `@typescript/native` goes.

The local Supabase stack (`supabase start`) runs from `supabase/config.toml`. Signing in with GitHub and Connect
GitHub need a GitHub OAuth app whose callback URL is `http://127.0.0.1:54321/auth/v1/callback`: put its client id and
secret in `.env.local` (`SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET`), where
the CLI reads them, and restart the stack.

After changing a migration, rebuild the local database from the migrations, as CI does (`supabase db start` if it is
not running, then `supabase db reset`, which discards its data), and run `pnpm db:types`. CI regenerates the types
from the migrations and fails if the committed file differs, so generate them with the Supabase CLI version its
database job pins.

## Docs pipeline

`/docs` is rendered by Fumadocs from Markdown under `content/docs/` (gitignored, generated). `pnpm sync:docs`
(`scripts/sync-docs.mjs`) runs before `dev`/`build`: it reads each docs version's markdown from git and transforms
it (injects frontmatter, rewrites links). The pages stay `.md`, compiled as plain Markdown, so nothing in a release's
docs runs as code when the site builds.

The versions are listed in [`docs-versions.json`](docs-versions.json), newest first: each release line (`0.4`)
with the Core and Pro release tags its docs come from (Core's repository, and the public `tenantry-pro-docs`
repository, which each Pro release publishes and tags). The newest is served at `/docs`, each older one at
`/docs/v<version>` with a notice pointing to the latest; the sidebar has a version dropdown and search covers
the version being read. The tags are read from partial clones kept in `content/_src/` (gitignored), so every
build, local ones included, shows what the released packages do. A release line keeps one API: each minor before
1.0 (`0.4`, `0.5`), each major from 1.0 (`1`). Each group ends with a Changelog page: the line's releases from the
tag's `CHANGELOG.md`, with a link to the rest (`scripts/docs-changelog.mjs`); tenantry-pro-docs has Pro's from 0.5.0.
Each sync fetches the listed tags again, so moving a tenantry-pro-docs tag to corrected docs publishes them at the next
deployment. A release build fails when a link in the docs reaches no page or heading the sync wrote, or is
still relative after rewriting (`scripts/docs-links.mjs`).

Releasing Core or Pro needs no edit to the site. The owner pushes a signed `v*` tag, and the repository's release
workflow publishes the packages; Pro's also publishes its docs to tenantry-pro-docs under the same tag. The
`docs-versions` workflow runs hourly, at 23 minutes past, and reads both repositories' tags
(`scripts/docs-versions-update.mjs`). A Core tag counts once NuGet lists its version (Tenantry.Core's registration),
since Core is tagged before its release runs; pre-release tags never count. To take a Core release back, unlist it on
NuGet and the next run drops it; a Pro release is dropped by deleting its tag from tenantry-pro-docs. A line is listed
once both Core and Pro have a release in it, with the newest release of each, so a new minor released by Core first
stays off the site until Pro's release, and the previous line is shown meanwhile. Only the newest line is shown until a
release has been sold (`FIRST_SOLD_RELEASE` in `scripts/docs-versions.mjs`).

The same run reads what the site says about the newest release from the release itself and writes it to
[`newest-release.json`](newest-release.json): the .NET versions Core's package targets, the number of sample folders,
and the setup snippets of Pro's installation guide, which the Pro access page shows with the environment's GitHub org.
The snippets must still hold the feed, the package patterns, the environment variables and the licence key's setting
that the portal's own text names (`scripts/install-snippets.mjs`). The home, Pro and comparison pages and the portal
take these from the file, and the version badge and the docs from `docs-versions.json`. When either file changes, the
workflow commits both to master and staging and runs the test and audit workflows on the commit, since its own pushes
start none. Production deploys the commit once they pass. A run that finds nothing new but sees its own commit at
master's head runs those workflows if they never ran on it, and fast-forwards staging to it; staging with commits master
lacks is left alone. A release is live at the first run after its packages are published, so within the hour, plus the
few minutes the checks and the build take. Run the workflow from the Actions tab to publish sooner.

A release whose tag has no `docs` folder, or whose `CHANGELOG.md` has no section for it, is left out, and its line keeps
the release before it. So is a release of the newest line that does not give the facts above: a nuspec without target
frameworks, no sample folder, or an installation guide without those snippets. The run commits what it can publish, then
fails, with the releases left out and why in its summary, and fails again each hour until the release is fixed or
replaced. A run that cannot reach NuGet or read a file from a tag publishes nothing. A release build fails before
deploying, and production keeps the last deployment, if a listed tag cannot be read or its docs are incomplete. The code
samples on the home and Pro pages are not release data: when a minor release changes the API they show, they are updated
by hand.

If a release has not reached the site after an hour, check in this order: NuGet lists the Core version
(`https://www.nuget.org/packages/Tenantry.Core`), or tenantry-pro-docs has the Pro tag (Pro's publish-docs job may need
a re-run); the latest `docs-versions` run, whose summary names any release it left out; the test and audit runs on its
commit on master; then the Vercel deployment. `pnpm docs:update` does the same as the workflow locally, and
`pnpm docs:check` fails unless both files match the releases.

To preview unreleased docs locally, set an override, for example `PRO_DOCS_DIR=../tenantry-pro/docs pnpm dev` (or
`CORE_DOCS_DIR`); it replaces the newest version's docs. Vercel and CI builds refuse overrides.

## Blog

Posts are Markdown files in `content/blog/` (`<slug>.md`, served at `/blog/<slug>`), a fumadocs-mdx collection
whose frontmatter `source.config.ts` checks:

```yaml
---
title: Running EF Core migrations across tenant databases
description: One sentence, for the index, search results and link previews.
date: 2026-10-10 # published; `updated:` too, when it changes in substance
author: Oliver McNally
versions: Tenantry 0.5, .NET 10, EF Core 10 # what its examples were checked against
tags: [dotnet, efcore, multitenancy] # dev.to's: at most four, lowercase letters and digits
next: { label: Read the migration guide, href: /docs/pro/migration-orchestration }
draft: true # until it is ready; then remove the line
---
```

Write plain Markdown, without MDX components: dev.to gets the same text. A generic type outside a code span
(`List<T>`) is read as HTML and disappears, as it would on dev.to. Merging a post to `master` publishes it. A draft
has a page locally and in the sandbox, marked as one, but is never in production, the RSS feed (`/blog/rss.xml`), the
sitemap or on dev.to.

**dev.to.** After each push to master, the `devto` workflow (`scripts/devto-sync.mjs`) waits until tenantry.dev serves
the pushed commit's posts, and only them (`/blog/posts.json`; production deploys a commit once its checks pass), then
creates each published post's dev.to article, or updates it when the post changed. It finds the article by its
canonical URL, the post's address here, so dev.to links back and search engines credit the site. A post put back to
draft or removed has its article unpublished, and published again with the post; the account's articles whose
canonical URL is not a blog address here are left alone. The site is the source: an edit or an unpublish made on
dev.to is undone the next time the sync finds the article differs. dev.to replaces a new article's tags with its own,
so the post's tags are sent only when its article is created. It needs the `DEVTO_API_KEY` secret (dev.to →
Settings → Extensions) and does nothing without it; the `DEVTO_ORGANIZATION_ID` variable publishes new articles under
that dev.to organisation. Run it from the Actions tab to retry.

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables (Supabase, Paddle,
GitHub App, licensing, and email). Nothing has a default: each environment sets its own. Server code reads them
through `serverConfig()` (`src/server/config/server-config.ts`), which the server validates when it starts, and the
browser through `publicConfig()` (`src/lib/public-config.ts`): the `NEXT_PUBLIC_` variables it uses, which are
compiled into the build, so the build checks them too and a change needs a redeploy. (`NEXT_PUBLIC_SITE_URL` is read
by the server only.) ESLint keeps `process.env` out of other code.
Operational runbooks (provisioning, key rotation, reconcile) are maintained privately by the maintainers.
