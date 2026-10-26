# AGENTS.md

Instructions for AI coding agents (and people) working in Gearbox, a hosted platform of FRC team apps. This file holds the repo-wide rules. **Each app's details are in its own `AGENTS.md`** (`workers/<app>/AGENTS.md`; `apps/<app>/AGENTS.md` points to it). Read the one for the app you're changing.

Each folder's `CLAUDE.md` only imports its `AGENTS.md` (`@AGENTS.md`), for tools that read that name. Write notes in `AGENTS.md`, never in `CLAUDE.md`.

| Area | Notes |
|---|---|
| ID (sign-in, Slack, Discord, kiosks, schema) | `workers/g3id/AGENTS.md` |
| Portal (team home, admin pages) | `workers/portal/AGENTS.md` |
| Platform (sign-up, console, app library, reports, docs site) | `workers/platform/AGENTS.md` |
| Gateway (team addresses, dev gateway, icons) | `workers/gateway/AGENTS.md` |
| Attendance, Scouting, Orders, Shop, Skill Tree, Inventory, Schedule, Pit, Edge | `workers/<app>/AGENTS.md` |
| Edge agent | `workers/edge/AGENTS.md` (also for `devices/edge-agent`) |
| Pit log downloader, match logs | `devices/pit-log-downloader/AGENTS.md` |
| Team appearance, colors, shared bar, theme, tutorial mode | `packages/ui/AGENTS.md` |
| Public demo | `packages/demo/AGENTS.md` |

**Keep these files current**: a change to how an app works updates its `AGENTS.md` in the same PR (a new app adds one, with a `CLAUDE.md` holding `@AGENTS.md`); a rule for every app goes here. Write tersely, with file paths as the source of truth, and remove what's no longer true.

## Quick Start

**Install & Develop:**
```bash
pnpm install
pnpm dev              # Start all apps and workers in parallel
pnpm typecheck        # Type check all packages
pnpm lint            # Run Biome linting and formatting
```

## Platform Roadmap (read this first)

These apps are being turned from one team's tools into a hosted platform that many teams share. The plan of record is `docs/roadmap/roadmap.md`. **Before changing code, read its Progress section and the phase your change touches**, so the change moves toward the plan instead of away from it.

**Rules that follow from the roadmap:**
- **No new team-specific values in code, config or migrations**: team name, number, domain, Slack channel IDs, time zone, currency, event keys. Read them from `@g3/site-config` (see "Site config" below), which becomes per-team data in Phase 2.
- **No fixed colors for content.** A team's colors come from Team Appearance, so everything a page shows uses them: `primary-*` for the team's color, `secondary-*` for grays, `bg-surface` for cards, `bg-page`, `bg-inset` and `border-line` (in plain CSS, the `--g3-*` variables). Text on a fill in the team's color is `text-on-primary` (plain CSS: `var(--g3-on-brand)`), never `text-white`: a team chooses light or dark text for its color. Don't write a hex value, `bg-white`, or a Tailwind color such as `red` or `blue` as an accent. A fixed color is only for meaning: red for an error or deleting, green for done, amber for a warning, a status badge. See "Editable team appearance" and "Color Implementation".
- **Page text is short and about what the user does.** A description, hint or empty state says what the user can do or needs to know, in a sentence or two. Leave out how it works underneath (storage, caches, endpoints, what the code does), what changed, and what users can see for themselves. Keep warnings about consequences (it can't be undone, who can see it) and steps an admin has to follow.
- **US English spelling everywhere**: page text, docs, comments and names in code (color, gray, canceled, labeled, recognize, center). The one exception is a value that's already stored: Orders' request status is `cancelled` in the database and the API, while pages show "Canceled".
- **No new single-team assumptions in schemas**: no `CHECK (id = 1)` settings rows, and no key that is unique across the whole table when it should be unique per team (a vendor key, a setting name, a PIN). New tables for a team's data should be easy to scope with a `team_id` later (Phase 3).
- **Sign-in and roles only through `@g3/auth`**. App workers don't read the session cookie themselves; in Phase 2 a gateway hands them the user and team.
- **Core apps must not depend on Edge.** Edge is an optional app any team can run with its own box (roadmap section "Edge: an app any team can run"). Orders part lookup and Shop printing treat it as an optional provider and must keep working (by hand) without it.
- **Hosting and deploy changes need the owners' yes first**: a new Cloudflare product, a paid add-on, a new vendor or a new domain. The roadmap's "Hosting and stack decisions" section lists what is already confirmed; ask before going beyond it.
- **Features that change what data is collected, how long it's kept or who can see it** must match the drafts in `docs/legal/` (Terms of Service, Privacy Policy). Update the draft in the same PR, or say in the PR that it needs a decision.

**Keep the roadmap current.** When a change completes or advances a step, update `docs/roadmap/roadmap.md` in the same PR: the step's Status, the Progress table, and a row in "What landed". If a change makes part of the plan wrong, fix the plan there and say so in the PR description. A roadmap-only change takes an empty changeset.

## Docs (docs.<platform>)

Admin-facing docs are Markdown in `apps/<app>/docs/*.md` (front matter `title`, `summary`, `order`, `pages`, `access`; `index.md` is the section's front page), built by `apps/platform/docs-plugin.ts` (details in `workers/platform/AGENTS.md`). Rules:
- **Docs read in order, basics to advanced**, and a page links only to pages before it (the build fails on a link ahead): name a later page in words.
- Every doc but `index.md` lists the routes it's about in `pages` (**main page first**: Tutorial mode follows it). **When a page's address changes or a page is added, update the `pages` of the doc about it in the same PR.** Keep a doc's `access` (`everyone`, `mentor`, `admin`) in step with who can open its page.
- **Pages never call `window.scrollTo`, read `window.scrollY` or set `document.body.style.overflow`** (Tutorial mode makes `#root` the scroller): use `scrollPageToTop()`, `pageScroller()` and `lockPageScroll()` from `@g3/ui`.
- **Keep the docs current.** A change to how an app is set up or used (a page, a setting, a button's name, who can do something) updates that app's `docs/` in the same PR. A new app adds `docs/index.md` and `docs/setup.md`. Write for a team's admins: what to do and where, in the words the pages use, never how it works underneath.
- `pnpm --filter @g3/platform test` fails on a broken link or heading.

## UI Alignment (read before changing a page)

The apps are being brought into one design language. The plan of record is `docs/roadmap/ui-alignment.md`: the decisions, the rules a page follows, each step's status and what each app still needs. **Read it before changing how a page looks or behaves**, and update its Progress table in the same PR as a step.

**Rules that follow from it:**
- **Build pages from the shared parts in `@g3/ui`** (`packages/ui/src/components/`): `Page` (title, `description`, `actions`, `width`), `PageLoading`, `Card`, `Stat`, `Button` (`primary`, `secondary`, `danger`; `size` `sm` or `lg`; `blocked`: grayed out like `disabled` but still clicked, so the page can say what's missing) and `buttonClass` for a link that looks like one, `ConfirmButton` and `ConfirmQuestion`, `Field` with `inputClass`, `TextField` (below), `ErrorBanner`, `SuccessBanner`, `Loading`, `Dialog`, `Toggle` and `Switch`, `Chip`, `Badge` with `tones`, `ProgressBar`, `focusRing`. Orders, Inventory, Skill Tree, Edge, ID, Portal, Pit and Shop are built from them; Scouting now uses the shared page frame, cards and standard controls, with its specialized drawing and touch layouts below shared styles in the CSS cascade. Its pages have React Router addresses; multi-step questions use `QuestionProvider` / `useQuestions` and the shared `Dialog`. Don't add an app's own copy of one: a part two apps need goes in `@g3/ui`. Tailwind finds their classes through `@source "./components"` in `packages/ui/src/index.css`.
- **Red means a problem, in every app**: an error, a delete or danger button, a "no" status, an overdue or over-budget mark (`ErrorBanner`, `Button variant="danger"`, `tones.danger`, `text-red-700`). The team's color (`primary-*`) never stands for one, since a team can choose any color.
- **An app opens on its most-used page**, the first in its bar. No page exists only to list other pages. A summary page is called Overview. **An address that isn't a page goes to the app's home** (a `path="*"` route to `/`; Scouting checks its own paths), never a blank page.
- **An app's settings page is called Admin** and is last in the bar. A page's title is its bar label.
- **Ask in the page** (`ConfirmButton`, a `Dialog`), never with `window.confirm`, `window.prompt` or `alert`.
- **Every text box is `TextField`** from `@g3/ui` (an input, or a textarea with `multiline`; it takes the element's own props), never a plain text `<input>` or `<textarea>`: `pnpm lint:text-fields` (CI) fails on one. `variant`: `default` (the `inputClass` look), `compact`, `inline`, `search`, `plain` (only your `className`). Give it a `kind` (`partName`, `reason`, `note`, `url`, …: the lists in `packages/demo/src/safe-text.ts`; add one there if none fits), which picks the safe text the public demo offers in its place, or `typeable` for a box that only filters the page or holds a number, price or color. A search box (`type="search"` or `variant="search"`) must only filter what the page already has.
- **No page scrolls sideways on a phone**, however long the text (`docs/roadmap/ui-alignment.md`, "Long text"): `@g3/ui` breaks a word too long for its line, so a page's job is `min-w-0` on a flex or grid item holding a name, `truncate` with a `title` for a one-line cell, `max-w-full` on a `select` with long options, and `relative overflow-x-auto` around a table that can be wider than the screen. Prices and dates never give way.
- **"Sign in" and "Sign out"**, not "Log in" or "Log Out". A chosen filter chip is near-black, not the team's color.
- **A signed-out visitor goes straight to sign in**, in every app: the moment the app knows nobody is signed in (its `/me`, or any call, answers 401), it calls `redirectToSignIn()` from `@g3/ui` (`packages/ui/src/sign-in.ts`: the team's ID sign-in page, coming back to the page they were on). No app shows a "Sign in" page of its own, except the team's front door: Portal's home, signed out, shows the team's number and name with Sign in and Sign up (ID's `/signup`), then "Not a team member? Visit the team's public site" (when it has one) and "Not team N? Find your team" (`PublicSiteLink` and `NotYourTeam` from `@g3/ui`, also under ID's sign-in pages) (`FrontDoor` in `apps/portal/src/plugins/home/home-page.tsx`); Portal's admin pages redirect like any app. An app that keeps working offline (Pit, Scouting) only does it on a 401, never because a call failed. ID's sign-in pages have the team's public site link and "Not team N? Find your team" (the platform's `/team`).
- **The sign-in app is called "ID"** in text ("your ID account"), and "G3 ID" as its wordmark and tab title, like any app. It isn't "G3ID".

## Repository Structure

pnpm workspaces:
- `apps/` — React frontends (g3id, portal, shop, pit, skill-tree, attendance, scouting, edge, orders, inventory, schedule, platform)
- `workers/` — Cloudflare Workers: one per app, serving its page and its API at `/api`, plus `gateway`, which routes every hostname to them
- `packages/` — shared libraries: `auth` (sign-in, tenancy helpers, manifests), `ui`, `site-config`, `slack`, `discord`, `demo`, `testing`
- `devices/` — software on hardware: `edge-agent` (Bun, arm64 binary), `pit-log-downloader` (Node 24)
- `infra/edge/` — hand-applied system config for the shop edge box

Stack: Hono, Drizzle (`drizzle-orm`, Hono and `@cloudflare/workers-types` are in the pnpm catalog, `"catalog:"`), Cloudflare Workers, D1, KV, R2; React, React Router, Tailwind CSS v4, Vite. Sign-in: the team's chat (Slack or Discord), Google, GitHub, Steam, email (local), PIN (kiosk). Apps are plugin-based (each feature a plugin with routes and nav items).

## Hosting: one worker per app, one gateway

- Each app is one worker: in production it serves the built app (`[env.production.assets]` → `apps/<app>/dist`, single-page-app fallback) and its Hono API at `/api` on the app's own address. Only `/api/*` runs worker code (`run_worker_first`); each worker's default export is wrapped in `withApiPrefix()` (`@g3/site-config/worker`), which drops `/api` so routes stay written as `/requests`, like in dev where Vite's proxy drops it. Apps call `"/api"` (same origin) in production and dev; a page calls another app's API at `apiPath("<app>")` (`/api/~<app>` on its own address: the gateway sends it to that app for the same team, and in dev the `siteConfig()` Vite plugin proxies it to the app's local worker). `apiUrl("<app>")` (`https://<app>.<domain>/api`) is only for addresses outside services call, like webhooks.
- **Workers call each other at `/api` too** (`http://g3id/api/auth/me`, `http://edge/api/lookup`): in production, anything outside `/api/*` would get the app's page.
- `workers/gateway` forwards each hostname to its app's worker: every team is at `<number>-<app>.<platform>` (home: `<number>.<platform>`, Portal). For `/api` it sets `X-Team-Id`, `X-User-Id`, `X-Session-Type`, `X-User-Roles` and drops other teams' sessions. Details: `workers/gateway/AGENTS.md`.
- Production deploys from GitHub Actions when a release lands on `public` (`release.yml` → `deploy.yml`, migrations first). By hand: `pnpm db:migrate:remote`, then `pnpm run deploy` (all) or `pnpm --filter @g3/worker-<app> run deploy` (`wrangler deploy --env production`; `[env.production.build]` in its `wrangler.toml` builds the app first). No Cloudflare Pages. See `docs/deploy.md`, including the one-time switch-over.

## Team-scoped apps (roadmap Phase 3)

- **The request's team is in `@g3/auth`.** `requireAuth` and the other middlewares set `c.get("teamId")`: the gateway's `X-Team-Id` (`TEAM_HEADER`, `requestTeamId()`), or the site's team without it (an app's own port in dev, tests). A session counts only on its own team's addresses (another team's member is signed out), so `teamId` is always the signed-in user's team. Who is signed in is still asked of G3ID, never taken from the gateway's `X-User-Id` alone.
- **Tenancy helpers, also in `@g3/auth`** (the roadmap's platform SDK; no separate package): `inTeam(table, teamId, ...conditions)` for every `where` on a team table, `withTeam(teamId, values)` for every insert into one, `teamMembers(env, teamId)` / `activeMembers` (G3ID's `/api/internal/teams/:id/members`, with `isAdmin`/`isMentor`; apps keep no list of people), `deleteTeamRows(db, teamId, tables)`, `sendMemberDM(env, teamId, userIds, text)` and `sendTeamMessage(env, teamId, channel, text)` (G3ID's `/api/internal/teams/:id/chat/dm-members` and `/chat/message` send them on the team's chat, Slack or Discord, with its own bot; the token never leaves G3ID; nothing is sent when the team has no chat; text is in Gearbox's chat format, see "Discord" below), `encryptSecret`/`decryptSecret` (AES-GCM with the worker's `SECRETS_KEY`, for a team's secrets kept in D1), and `forwardIdentity(c)` (cookie + `X-Team-Id`) for calling another app as the user. Orders' part lookup and Shop's printing use it to reach the member's own team's edge box.
- **Tenancy lint** (`pnpm lint:tenancy`, `scripts/tenancy-lint.ts`, in CI): for each team-scoped app listed in it, a Drizzle query on a team table without `inTeam`, an insert without `withTeam`, any raw `.prepare(`, or a `sql` template naming a team table fails. A query that must read every team's rows (a cron finding which teams to work on) goes right after a `// tenancy: all teams (<why>)` comment. Add an app (its dir and team tables) in the pull request that makes it team-scoped.
- **Isolation test** (`@g3/testing/isolation`, `checkIsolation({ app, seed, snapshot, bodies, skip })`): every team-scoped app has one (`test/isolation.test.ts`). It seeds teams A and B, calls every route of the exported Hono `app` as A's admin, mentor, student and kiosk session with B's ids, and fails if an answer contains a marker only B has or B's snapshot changes. It skips `/internal/*`, which only other workers reach.
- **Deleting a team's data:** every team-scoped app has `DELETE /internal/teams/:teamId` (`/api/internal`, which the gateway never answers), deleting all its rows with `deleteTeamRows(db, teamId, tables)` from `@g3/auth` (one batch, children first; Shop also its R2 prefix and Onshape webhook, Edge its box key and link, Orders its catalog-copied note). The operators' console calls each app's (the platform's service bindings: every manifest with a `delete` hook, `workers/platform/src/registry.ts`) before G3ID's, and deletes nothing else if one fails; the app library calls it too, 90 days after a team switches the app off. Each app's isolation test also runs `checkTeamDeletion` (A's data all gone, B's untouched, a second delete OK). A new team-scoped app adds the route, `delete: true` in its manifest, its binding on the platform and the test.
- Done: Skill Tree, Pit, Attendance, Inventory, Orders, Shop, Edge, Scouting, Schedule. Left: Portal.

## App library (roadmap Phase 4)

- **Manifests:** every app has `workers/<app>/src/manifest.ts` (`defineManifest`, type `AppManifest` in `@g3/auth`; exported as `@g3/worker-<app>/manifest`): slug (its `site.apps` name), name, summary, roles, integrations, availability (`"every team"`, or `"site team"` for an app whose data isn't per team yet: Scouting), `alwaysOn` (ID, Portal), version from its package.json, `hooks: { seed, delete, export, demo }` (`demo`: the public demo's sample data, below), `settings` (each team setting's key, label, type, default, who edits it, the app's own `page` that also edits it (`<app>:<path>` for another app's page), and `integration` for an integration's keys) and `plugins` (optional parts switched on inside the app: Scouting's engagement modules). Keep a manifest's settings and defaults in step with the app's own code. A new app adds one, and the platform's `src/registry.ts` imports it (and its binding if it has hooks).
- **Features that need another app** are left out of pages while the team has that app off: `useAppOn(app)` (components; show while it isn't `false`, so a team with the app never sees it flicker) and `appOn(app)` (async code) from `@g3/ui`, both from the platform's `/team/apps`. Done for Orders' Inventory setting on its Admin page, Shop's print buttons (Edge), Inventory's Orders catalog, Request buttons and request links (`useOrdersOn`), and Portal's tiles and the All Apps drawer (an app that's off isn't listed). A worker asks with `teamHasApp(env, teamId, app)` from `@g3/auth` (G3ID's `/internal/teams/:id/apps`, from the platform; null when it can't tell): Orders' `GET /inventory` says nothing and `inventoryRequired` is false while Inventory is off. A new cross-app feature should do the same.
- Exports (`GET /api/internal/teams/:id/export`, `exportTeamRows`) **leave secrets out** and say what's missing in `notes`. Big settings changes go in the team's log with `logTeamChange` from `@g3/auth` (field labels only, never values). Details: `workers/platform/AGENTS.md`.

## Public demo (team 9999)

Every app has sample data behind its manifest's `demo` hook (`src/demo.ts`, plus `GET /internal/demo/words`, tested with `checkDemoHook`); keep it plain and neutral. **A new route that reaches outside the platform (a message, a key, a webhook) goes in `DEMO_BLOCKED`.** Text boxes need a `kind` (see `TextField` above). Details: `packages/demo/AGENTS.md`.

## Site config (team, domain)

- The deployment and its own (site) team live in `packages/site-config/src/site.ts` (`@g3/site-config`): the site team's number, name and short name ("G3", which are also its default Team Appearance), the domain, the platform's domain (`platformDomain`), each app's subdomain, public links, the Slack bot's name. **Never hard-code the domain, team number or "G3" branding**: use `appUrl("shop")`, `apiUrl("orders")` (`https://orders.<domain>/api`), `allAppsUrl`, `wordmark("Shop")` ("G3 SHOP"), `appTitle("Shop")` ("G3 Shop"), `teamLinks`, `teamKey` ("frc1648"), `site.team.*`. Internal names (`@g3/*` packages, `g3_session`/`g3_theme` cookies, `--g3-*` CSS, `G3ID` binding, database names) stay as they are.
- CORS for every worker is `cors({ origin: corsOrigin })`: https on the domain and its subdomains, plus localhost. No `*.pages.dev`.
- **Team context per page (roadmap 2.10): one build serves every team.** Nothing team-specific is built into a page. Its team comes from its address (`pageTeamId` / `pageTeamNumber` in `@g3/site-config`: the site team's addresses and plain localhost are the site team, `<number>-<app>.<platform>` or `.gearbox.localhost` is team `<number>`), and its names, colors, logo and links from that team's Team Appearance settings (G3ID's `/team/ui`, loaded by `@g3/ui`). In pages use `useTeamNames()` from `@g3/ui` (`name`, `shortName`, `number`, `wordmark()`, `appTitle()`, `links`), not site-config's `wordmark`/`appTitle`/`site.team`, which only know the site team (they stay for workers and Slack text). `appUrl()`, `allAppsUrl` and the other address helpers use the page's team. `index.html` has no placeholders: titles are the app's own name and `@g3/ui` puts the team's short name in front. `siteConfig()` in each `vite.config` sets `productionEnv` (`VITE_API_BASE_URL: "/api"`), the version defines and the dev gateway (`localGateway`). No `.env.production` files.
- Files that can't import it (`wrangler.toml` production URLs, the gateway's route, OAuth redirect URIs, `TEAM_NUMBER`; the edge env examples) are written by `pnpm configure` (`scripts/configure.ts`); CI runs `pnpm configure --check`.

## Colors

Built-in colors are in `packages/ui/src/index.css` (`@theme`) and `colors.css`; a team's own replace them at runtime. Use `primary-*` (team color), `secondary-*`/`gray-*` (grays), `bg-surface`, `bg-page`, `bg-inset`, `border-line`, and `text-on-primary` on a solid `primary` fill (500 and darker). Write light-mode classes: dark mode is derived (`theme.css`, `theme-palette.css`). Plain CSS uses the `--g3-*` variables. A hex value only for a color that must not change in dark mode, never for the team's color or a gray. Details: `packages/ui/AGENTS.md`.

- **App versions**: SemVer, one per app, shared by its page and its worker (Changesets `fixed` groups in `.changeset/config.json`; the edge agent has its own). The worker's `package.json` is the source: `/health` returns it (`import packageJson from "../package.json"`), and apps get it through `siteConfig()` as `appVersion` / `versionLabel()` from `@g3/site-config/versions` (shown in the navbar's tooltip and drawer). Never hard-code a version.
- **Platform version**: CalVer `YEAR.MONTH.N` in the root `package.json`; each release and the app versions in it are listed in `RELEASES.md`.
- **Branches**: work merges into `staging`, which deploys to **staging**; `public` is the released branch, deployed to **production** once the release workflow has committed the release. Both go through `.github/workflows/deploy.yml` (called by `staging.yml` and `release.yml`): migrations, then every app's worker, then the gateway. Cloudflare's Git integration (Workers Builds) isn't used. **For now** the repository variable `PRODUCTION_BRANCH` can be `staging`: then every push to `staging` also deploys production (after staging's deploy; `staging.yml`), and the release workflow doesn't; unset, production deploys only from releases. The repository variable `STAGING_BRANCH` likewise moves staging to another branch (a feature to try there; unset, `staging`), and running `staging.yml` by hand deploys the branch it's run on (`docs/deploy.md`, "Trying a branch on staging").
- **Staging** (`docs/deploy.md`, "Staging"): production's addresses with `-dev` on the first part, on g3robotics.com (`1648-orders-dev.g3robotics.com`, the platform at `dev.g3robotics.com`; `site.staging`). A staging build (`GEARBOX_STAGING=1` for pages, `define` `__G3_STAGING__` for workers) sets `isStaging` in `@g3/site-config`, and every address helper goes through `platformHost`/`platformLabel`, so **never build a platform address by hand** (`${label}.${site.platformDomain}`). Pages get a "Staging" banner from the `siteConfig()` Vite plugin, linking the pull request the deployed commit merged (`lastPullRequest`: "Merge pull request #N" or a squash's "(#N)"). Each worker's `[env.staging]` is written by `pnpm configure` from its `[env.production]` with ids from `infra/staging/resources.json` (`pnpm staging:create` makes them): edit production's, never the generated part. Staging has its own Slack app, installed in G3's workspace, with its ids in `infra/staging/resources.json` (`slack`; `docs/deploy.md`, "Slack on staging"). `pnpm staging:copy-team` copies G3's data (only the site team's, for the privacy draft) from production into staging, leaving out sessions, codes, kiosks, encrypted settings and R2 (`scripts/staging-copy-team.ts`; Wrangler is run through `scripts/lib/wrangler.ts`, which avoids its npm check).
- **Every PR into `staging` that changes an app adds a changeset** (`pnpm changeset`: pick the app, patch/minor/major, a summary for users; `--empty` when nothing should be released). CI fails a PR without one. Shared packages (`packages/*`) are ignored by Changesets; record their changes against the affected apps.
- **Agents: write the changeset file yourself** (`pnpm changeset` is interactive). When a commit changes an app, add `.changeset/<short-name>.md` in the same commit:
  ```md
  ---
  "@g3/worker-orders": minor
  ---

  One line for the app's users: what changed for them.
  ```
  List each changed app once, by its worker package (`@g3/worker-<app>`, including `@g3/worker-portal`; the edge agent is `@g3/edge-agent`), with the bump from `.changeset/README.md`: **patch** for fixes and small tweaks, **minor** for new features that break nothing, **major** when users or deployers must act (a migration to run first, a removed page, a changed API). For changes that release nothing (docs, CI, tooling only), use an empty header (`---` then `---`). Say which bump you chose and why when you report the commit, so a person can check it; `pnpm release:preview` shows the resulting versions.
- **Releasing**: `.github/workflows/release-pr.yml` keeps one `staging` → `public` PR open, titled with the next release (`pnpm release:preview`, which runs the release in a throwaway worktree). Merging it (merge commit only) runs `.github/workflows/release.yml` on `public`: applies the changesets (`pnpm release:version`: versions, CHANGELOG.md files, platform CalVer, RELEASES.md), commits "Release <platform>", tags `v<platform>` and each app's version (`pnpm release:tag`), and merges `public` back into `staging`. It pushes with the `RELEASE_DEPLOY_KEY` deploy key, which is on both rulesets' bypass lists. Its push of the release commit starts the workflow again, which finds nothing left to release and deploys production (`deploy.yml`); only such a run deploys, so production is always a released commit.

## Testing & Validation

Before committing:
```bash
pnpm biome check --write
pnpm -r --if-present typecheck
pnpm -r --if-present test     # or pnpm --filter @g3/worker-<app> test
```

**Worker tests** (`pnpm --filter @g3/worker-orders test`, or `pnpm test` for everything; CI runs them on every PR):
- Every worker has `vitest.config.mts` (`.mts`: the Workers test pool needs ESM) built by `workerTestConfig` from `packages/testing` (`@g3/testing`). Tests run inside the Workers runtime via `@cloudflare/vitest-pool-workers` (pinned in the pnpm catalog: Vitest 4.1.x only) against local D1/KV/R2 from the worker's wrangler config, with its D1 migrations applied before each test file (`packages/testing/src/setup.ts`). No Cloudflare account or secrets: `remoteBindings` is off, and tests must not rely on `.dev.vars`.
- Storage is per test file, shared by the tests in a file, so each test makes its own records (random URLs, generated PINs) instead of assuming an empty database.
- Test users have a team (`teamId`, the site's by default); `teamUsers(teamId)` gives the standard users in another team with ids of their own, and `asUser`/`callAs` send `X-Team-Id` like the gateway. The G3ID stub answers per team, including `/internal/teams/:id/members`.
- Other workers are stubbed: `G3ID` is a stub that answers `/auth/me` for the user in a test cookie (never admin/mentor for a `pin` session, like the real one), and other services (e.g. `EDGE`) can be `offlineService`. In tests, `callAs(student, "/path", { method, body })` / `jsonAs(...)` from `@g3/testing/worker` sign requests in as the users in `@g3/testing/users` (`student`, `otherStudent`, `mentor`, `admin`, `kioskAdmin`).
- G3ID itself is tested for real (`workers/g3id/test`): users and sessions are seeded with its own helpers (`createUser`, `sessionCookie`, `createUserWithPin`, `activateKiosk`).

## Development Servers

`pnpm dev` starts every app, worker and the gateway (`pnpm dev:silent`: without the port summary). Ports are in `.dev-ports.json` (and each `vite.config.ts` / `wrangler.toml`; add a new one in both):

| | g3id | shop | pit | portal | skill-tree | attendance | scouting | edge | orders | platform | gateway | inventory | schedule |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| app | 5173 | 5174 | 5175 | 5178 | 5180 | 5181 | 5182 | 5183 | 5184 | 5185 | — | 5186 | 5187 |
| worker | 8787 | 8788 | 8789 | — | 8790 | 8791 | 8792 | 8793 | 8794 | 8795 | 8796 | 8797 | 8798 |

Each worker's inspector port is its port + 442 (g3id 9229 … schedule 9240). Mock edge agent: 8700.

**Team addresses in dev**: the gateway on 8796 serves `http://<number>-<app>.gearbox.localhost:8796` (site team G3 is 1648; platform `gearbox.localhost:8796`, console `admin.gearbox.localhost:8796`); one sign-in covers every app. It listens on 127.0.0.1: for curl, add `--resolve <host>:8796:127.0.0.1`. More in `workers/gateway/AGENTS.md`.

Port conflicts ("Address already in use"): `fuser -k <ports>`, or `killall -9 workerd wrangler node`.

## Adding a new app

Copy an existing app (`apps/<app>`, e.g. `apps/inventory`) and worker (`workers/<app>`, e.g. `workers/inventory`): unique ports (`.dev-ports.json`, `vite.config.ts`, `wrangler.toml`), `package.json` with `name`, `type: "module"` and `dev`, its bindings. It also needs: a manifest (`src/manifest.ts`, imported by the platform's `src/registry.ts`), team scoping (tenancy lint entry, isolation test, delete and export hooks, platform binding), a demo hook, `docs/index.md` and `docs/setup.md`, the four icon files (`public/manifest.webmanifest`; see `packages/ui/AGENTS.md`), a Portal tile key, and an `AGENTS.md` in `workers/<app>` (with `apps/<app>/AGENTS.md` pointing to it, and a `CLAUDE.md` importing each).

## Deployment

See `docs/deploy.md`. Merging the release PR deploys production from GitHub Actions (`release.yml` → `deploy.yml`: migrations, each app's worker, the gateway); `pnpm run deploy` does it by hand after `pnpm db:migrate:remote`. Edge-agent upgrades: `infra/edge/README.md`. No Cloudflare Pages.

## Key Files

- `docs/roadmap/roadmap.md`, `docs/roadmap/ui-alignment.md` — the plans of record
- `docs/legal/` — draft Terms of Service and Privacy Policy
- `packages/ui/src/components/` — shared page parts
- `packages/auth/src/g3id.ts` — sign-in for every worker (`requireAuth`, `requireAdmin`, `requireMentor`, `requireOAuthSession`, `G3AuthVariables`); app-specific checks stay in that worker's `middleware/auth.ts`
- `workers/g3id/src/middleware/auth.ts` — G3ID's own (`requireAuth`, `requireAdmin`, `requireKioskToken`)
