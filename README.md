# tenantry-site

The Tenantry website, documentation, and commercial customer portal — a [Next.js](https://nextjs.org/)
16 app (App Router, React 19.3, Tailwind v4) that handles marketing, pricing, docs, and the
purchase → entitlement → access pipeline for **Tenantry Pro**.

## What it does

- The landing page, and pricing for Tenantry Pro through Paddle.
- The docs at `/docs`, searchable, through [Fumadocs](https://fumadocs.dev), taken from the `tenantry-core` and
  `tenantry-pro` repositories (see [Docs pipeline](#docs-pipeline)).
- The commercial backend: Paddle's notifications record each customer's subscriptions and payments, from which the
  site works out what they may use, issues their licence key, and serves Tenantry Pro's packages from its own NuGet
  feed, the package feed.
- The customer portal at `/dashboard/pro`: Access (the releases they may use, feed tokens and the licence key),
  Install (restoring from the package feed) and Billing (the subscriptions, with invoices and the payment method in
  Paddle's portal).

## Architecture

```
Paddle (merchant of record) ──webhook──▶ /api/webhook ──▶ subscriptions + payments ─▶ access, entitlement, licence
                                                              (Supabase, service role)
customer ─▶ /dashboard/pro ─▶ feed tokens ─▶ dotnet restore ─▶ /feed/v3 ─▶ the releases their entitlement allows
release workflow ─▶ PUT /feed/v3/package (publish key) ─▶ pro_releases, pro_packages + the storage bucket
cron ─▶ /api/reconcile ─▶ recompute access and entitlement, retry what failed
```

The package feed (`/feed/v3/index.json`, `src/server/feed`) serves an active or in-grace subscriber every release, a
lapsed customer the vested releases, and a lapsed customer with nothing vested nothing. Customers authenticate with
feed tokens they create on the Access page; the licence key is never a feed credential. GitHub is only a way to sign
in.

Key code is in `src/server`, in layers whose imports point only down this list (ESLint enforces it):

- `feed/` — Tenantry Pro's NuGet v3 feed (`/feed/v3/index.json`, routed by `src/app/feed/v3`): each customer's feed
  tokens, the read resources filtered to the releases they may use, and publishing for the release workflow.
  `scripts/feed-e2e.sh` runs a real `dotnet restore` against it.
- `billing/` — the rules and services: what a customer may access now and owns for good, computed from their
  subscriptions and payments (`entitlement-policy.ts`, with the Paddle behaviour it assumes in
  `paddle-assumptions.ts`); storing that and keeping their licence and emails in line with it (`customer-access.ts`);
  applying Paddle's notifications (`apply-paddle-event.ts`); the reconcile run; and the Pro pages' read models, one per page, each reading only what its page shows (`pro-pages.ts`).
- `jobs/` — the worker that runs each customer's jobs (Paddle events and reconciles) one at a time and in order.
- `integrations/` — Paddle, email (Resend) and the licence issuer.
- `db/` — `createUserClient` (the signed-in user's session; RLS applies) and `createServiceRoleClient` (bypasses
  RLS), and the only modules that query the database: the billing tables' store, the customer jobs and the
  dashboard's reads. The clients are typed by `src/lib/supabase/database.types.ts`, which is generated from the
  migrations.
- `config/` — the server's configuration, `serverConfig()`: every setting, validated when the server starts.

Modules in `src/server` import `server-only` (except `db/update-session.ts`, which the proxy runs), so a client
component that pulls one in fails the build. The services that change a customer's access (`customer-access.ts`,
`reconcile-customer.ts`, `apply-paddle-event.ts`) take what they use from the layers below as
their last argument (`billing/deps.ts`), defaulting to the real modules, so their tests pass an in-memory billing store
and fakes instead of replacing modules; the read models are tested against a fake Supabase client. `src/lib` holds
helpers for both sides, and `src/test` the fakes the tests share.

The database schema, with its RLS policies and functions, starts with
`supabase/migrations/20261002120000_baseline.sql`; later changes are migrations after it. Their tests are in
`supabase/tests/database/` (`supabase test db`, which also passes with `--linked` against a hosted database), those
that need the local stack in `supabase/local-tests/` (`supabase test db supabase/local-tests`), and a migration that
moves data is tested against rows of the schema before it in `supabase/migration-tests/`, in a folder named after the
migration (`pnpm test:migrations` runs every folder).

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

The local Supabase stack (`supabase start`) runs from `supabase/config.toml`. Signing in with GitHub needs a GitHub
OAuth app whose callback URL is `http://127.0.0.1:54321/auth/v1/callback`: put its client id and
secret in `.env.local` (`SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET`), where
the CLI reads them, and restart the stack.

After changing a migration, rebuild the local database from the migrations, as CI does (`supabase db start` if it is
not running, then `supabase db reset`, which discards its data), and run `pnpm db:types`. CI regenerates the types
from the migrations and fails if the committed file differs, so generate them with the Supabase CLI version its
database job pins.

## Package feed: publishing

Tenantry Pro's release workflow and `scripts/feed-publish.sh` publish packages with the endpoint below. This is the
contract both rely on; change it here and in both clients together.

`PUT /feed/v3/package`, which is what `dotnet nuget push --source <site>/feed/v3/index.json --api-key <key>` sends: the
`.nupkg` as a multipart form file. It takes one of two credentials:

- The release workflow sends a GitHub Actions OIDC token as `Authorization: Bearer <token>`, requested with the audience
  `<site>/feed` (`https://tenantry.dev/feed` in production). The site checks it against GitHub's signing keys and
  accepts it only from `.github/workflows/release.yml` in `tenantry-org/tenantry-pro`, running for a `v*` tag pushed by
  a login in `FEED_PUBLISH_ACTORS` (comma-separated). Without that setting, no token is accepted. No key is stored
  anywhere for it (`src/server/feed/github-oidc.ts`).
- The operator's script, for the sandbox, sends a publish key in the `X-NuGet-ApiKey` header. The deployment holds only
  the key's SHA-256 (`FEED_PUBLISH_KEY_SHA256`); without it every push with a key is refused. Production can leave it
  unset once releases publish with OIDC tokens.

| Answer | Meaning                                                                               | What a client does  |
| ------ | ------------------------------------------------------------------------------------- | ------------------- |
| 201    | Published. The package's release is recorded with its first package.                  | Carry on.           |
| 409    | This id and version is already published with exactly these bytes (the same SHA-512). | Treat as published. |
| 400    | Refused, with the reason as text (below).                                             | Fail.               |
| 403    | No credential, the wrong key, or an OIDC token refused, with the reason as text.      | Fail.               |
| 413    | Larger than 4 MB (a Vercel function takes a body of at most 4.5 MB).                  | Fail.               |

`dotnet nuget push --skip-duplicate` and the script treat 409 as published, so re-running a release is safe. Every other
refusal is 400, never 409, so that `--skip-duplicate` cannot hide it: an id that is not `Tenantry.Pro` or
`Tenantry.Pro.*`, or differs only in case from a published one, including one published at the same moment; a version
that is neither `major.minor.patch` nor a release candidate `major.minor.patch-rc.N` (N from 1, no leading zeros, lower
case, no build metadata), as Pro's release process tags them; different bytes under a version already published (a
published version never changes: publish a new one); a `tenantry-release.json` date outside the rules below, or a
security flag that disagrees with its release or is set on an `X.Y.0` release or a release candidate; a patch release
whose `X.Y.0` release is not published; a package that cannot be read, or whose `tenantry-release.json` is not a JSON
object.

A release candidate is published and served like any release, and dated when it is published; it never takes its
minor's date. The feed lists versions in
SemVer's order, each candidate before its release, so NuGet restores a candidate only when the version or range asked
for allows prereleases (`0.8.0-rc.1`, `0.8.0-*`), never for a range such as `0.*`. Search leaves candidates out unless
asked for `prerelease=true` and `semVerLevel=2.0.0`.

A package may carry `tenantry-release.json` at its root: `{ "releasedAt": "<ISO 8601>", "security": <bool> }`, which
Pro's release workflow writes from the signed tag (its date, and `Security:` in its message). `releasedAt` may be at most
3 days before the push and 5 minutes after it, and not before an earlier version's date (a candidate is earlier than its
release); without it the release is dated when its first package is published. Every patch release, a security fix or
not, is dated as its `X.Y.0` release for vesting, so customers whose vested releases include `X.Y.0` can restore all of
its patches; the security flag is recorded and listed, and changes no date. The first package of a release fixes its
date and flag; later packages of the same release are checked only for the flag.

`GET /feed/v3/package` with the publish key in `X-NuGet-ApiKey` lists what the feed holds: each release's version, dates
and security flag, with its packages' ids, sizes and SHA-512s. Feed tokens and OIDC tokens cannot read it.

The publish key is a random string, generated once per environment; only its hash goes into the deployment:

```bash
key="$(openssl rand -base64 48 | tr -d '\n/+=')"   # store it in the password manager and the release workflow's secret
printf '%s' "$key" | shasum -a 256 | cut -d' ' -f1  # FEED_PUBLISH_KEY_SHA256 for that environment
```

`FEED_PUBLISH_KEY="$key" scripts/feed-publish.sh push https://sandbox.tenantry.dev ./artifacts` pushes a folder of
packages oldest version first, each release candidate before its release, and `scripts/feed-publish.sh list https://sandbox.tenantry.dev` prints the listing.

## Package feed: tokens, access and testing

A customer creates and revokes feed tokens on the Access page (`src/app/dashboard/pro/actions.ts`); a token is shown
once, only its SHA-256 is stored, and a customer holds at most 10. The feed, the Access page and the Billing page take
what a customer may use from the same rules (`entitlement-policy.ts`: `currentAccess`, `canRestore`, `mayUseRelease`),
so a grace period that has ended stops the feed serving every release at the moment the pages stop saying it does.
Every feed request is counted against the client's IP address before any token is looked up: the route calls
`@vercel/firewall`'s `checkRateLimit` with the rate limit ID `package-feed` (`src/server/feed/rate-limit.ts`) and
answers 429 over the limit. The limit itself is a Vercel Firewall rule with that ID, set in the dashboard. Without the rule, in
`next dev`, or when the firewall cannot be reached, the request goes ahead and a warning is logged. A credential that is
not shaped like a feed token is refused without a database query.

Each package download (a redirect to the package file) is recorded in `feed_downloads`: the token, the package and
version, the time, and the client's network (an IPv4 address's /24, an IPv6 address's /48). Only the service role reads
it. The daily reconcile run deletes records older than 90 days, the period the privacy policy states.

`scripts/feed-e2e.sh` (`pnpm test:feed-e2e`) runs the whole journey against a local stack: publishing, creating tokens
through the Access page's actions, restoring as a subscriber, a lapsed customer with vested releases and one without,
revoking a token, and vesting through `scripts/rehearse.mjs` and reconcile. `scripts/rehearse.mjs` produces, in the
sandbox only, the states that take a year to reach (vested, an annual term, a refund, a chargeback, an operator grant)
and undoes them.

## Docs pipeline

`/docs` is rendered by Fumadocs from Markdown under `content/docs/` (gitignored, generated). `pnpm sync:docs`
(`scripts/sync-docs.mjs`) runs before `dev`/`build`: it reads each docs version's markdown from git and transforms
it (injects frontmatter, rewrites links). The pages stay `.md`, compiled as plain Markdown, so nothing in a release's
docs runs as code when the site builds.

The versions are listed in [`docs-versions.json`](docs-versions.json), newest first: each minor version (`0.4`,
`1.2`) with the Core and Pro release tags its docs come from (Core's repository, and the public `tenantry-pro-docs`
repository, which each Pro release publishes and tags). The newest is served at `/docs`, each older one at
`/docs/v<version>` with a notice pointing to the latest; the sidebar has a version dropdown and search covers
the version being read. The tags are read from partial clones kept in `content/_src/` (gitignored), so every
build, local ones included, shows what the released packages do. Each minor has its own docs, after 1.0 as before,
because a customer whose rights to new releases end at a minor needs the docs of the release they can restore; the
newest patch of each minor is shown. Each group ends with a Changelog page: the minor's releases from the tag's
`CHANGELOG.md`, with a link to the rest (`scripts/docs-changelog.mjs`); tenantry-pro-docs has Pro's from 0.5.0.
Each sync fetches the listed tags again, so moving a tenantry-pro-docs tag to corrected docs publishes them at the next
deployment. A release build fails when a link in the docs reaches no page or heading the sync wrote, or is
still relative after rewriting (`scripts/docs-links.mjs`).

Releasing Core or Pro needs no edit to the site. The owner pushes a signed `v*` tag, and the repository's release
workflow publishes the packages; Pro's also publishes its docs to tenantry-pro-docs under the same tag. The
`docs-versions` workflow runs hourly, at 23 minutes past, and reads both repositories' tags
(`scripts/docs-versions-update.mjs`). A Core tag counts once NuGet lists its version (Tenantry.Core's registration),
since Core is tagged before its release runs; pre-release tags never count. To take a Core release back, unlist it on
NuGet and the next run drops it; a Pro release is dropped by deleting its tag from tenantry-pro-docs. A minor is listed
once both Core and Pro have a release in it, with the newest patch of each, so a new minor released by Core first
stays off the site until Pro's release, and the previous minor is shown meanwhile. Only the newest minor is shown until
a release has been sold. When checkout opens, `FIRST_SOLD_RELEASE` in `scripts/docs-versions.mjs` is set to Core's and
Pro's newest published releases (their patches can differ, such as `{ core: 'v0.8.1', pro: 'v0.8.0' }`); from then on
every minor from that one is shown, and each product's changelog starts at its own release sold.

The same run reads what the site says about the newest release from the release itself and writes it to
[`newest-release.json`](newest-release.json): the .NET versions Core's package targets and the number of sample
folders. The home, Pro and comparison pages take these from the file, and the version badge and the docs from `docs-versions.json`. When either file changes, the
workflow commits both to master and staging and runs the test and audit workflows on the commit, since its own pushes
start none. Production deploys the commit once they pass. A run that finds nothing new but sees its own commit at
master's head runs those workflows if they never ran on it, and fast-forwards staging to it; staging with commits master
lacks is left alone. A release is live at the first run after its packages are published, so within the hour, plus the
few minutes the checks and the build take. Run the workflow from the Actions tab to publish sooner.

A release whose tag has no `docs` folder, or whose `CHANGELOG.md` has no section for it, is left out, and its line keeps
the release before it. So is a release of the newest line that does not give the facts above: a nuspec without target
frameworks, or no sample folder. The run commits what it can publish, then
fails, with the releases left out and why in its summary, and fails again each hour until the release is fixed or
replaced. A run that cannot reach NuGet or read a file from a tag publishes nothing. A release build fails before
deploying, and production keeps the last deployment, if a listed tag cannot be read or its docs are incomplete. Two things
on the site are not release data. The code samples on the home and Pro pages are updated by hand when a minor release
changes the API they show. The instructions for restoring from the package feed (the Install page and the emails) are
written by the site, which serves the feed, with its own address (`src/lib/install-snippets.ts`); Pro's installation
guide uses the same source key and variable (`tenantry-pro`, `TENANTRY_FEED_TOKEN`), so the two agree whatever a
release's guide says.

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

See [`.env.example`](.env.example) for the full list of environment variables (Supabase, Paddle, licensing, the
package feed and email). Nothing has a default: each environment sets its own. Server code reads them
through `serverConfig()` (`src/server/config/server-config.ts`), which the server validates when it starts, and the
browser through `publicConfig()` (`src/lib/public-config.ts`): the `NEXT_PUBLIC_` variables it uses, which are
compiled into the build, so the build checks them too and a change needs a redeploy. (`NEXT_PUBLIC_SITE_URL` is read
by the server only.) ESLint keeps `process.env` out of other code.
Operational runbooks (setting up each environment, key rotation, reconcile) are maintained privately by the
maintainers.
