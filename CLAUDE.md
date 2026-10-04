# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**Install & Develop:**
```bash
pnpm install
pnpm dev              # Start all apps and workers in parallel
pnpm typecheck        # Type check all packages
pnpm lint            # Run Biome linting and formatting
```

**Commit Quality:**
```bash
pnpm biome check --write   # Fix formatting/linting before commit
pnpm -r --if-present typecheck  # Ensure no type errors
```

## Repository Structure

**Monorepo using pnpm workspaces:**

- `apps/` — React frontends (g3id, portal, shop, pit, attendance, scouting, edge, orders)
- `workers/` — Cloudflare Workers backends (g3id, shop, pit, skill-tree, attendance, scouting, edge, orders)
- `packages/` — Shared libraries (auth, ui, slack)
- `devices/` — Software that runs on physical hardware (edge-agent: Bun, compiled to an arm64 binary)
- `infra/edge/` — Hand-applied system config for the shop edge box

## Architecture Overview

### Core Stack
- **Backend**: Hono (routing), Drizzle ORM (database), Cloudflare Workers (serverless)
- **Frontend**: React, React Router, Tailwind CSS v4
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Storage**: Cloudflare KV (sessions, rate limiting)
- **Auth**: Slack (primary), Google, GitHub, Steam, Email (local), PIN (kiosk)

### Key Systems

**G3ID Authentication Worker** (`workers/g3id/`)
- RESTful routes at `/auth/*` for login flows
- Slack integration at `/slack/*` for commands and events
- PIN authentication at `/auth/pin` for kiosk devices
- Admin routes at `/admin/*` (user management, kiosk device management)
- Database schema in `src/db/schema.ts` with migrations in `src/db/migrations/`
- Session management: OAuth sessions stored in KV with D1 backup, PIN sessions in D1 only
- **Important**: PIN sessions cannot access admin routes (enforced in `middleware/auth.ts`)

**G3ID Web App** (`apps/g3id/`)
- Plugin-based architecture: each feature is a plugin with routes and nav items
- Color system centralized in `packages/ui/src/index.css` using Tailwind v4 `@theme` block
- Primary color: #A32035 (burgundy), Secondary: neutral grays (#f8f8f8–#1a1a1a)
- Navbar updates auth state on every route change (useLocation dependency)

**Attendance Worker** (`workers/attendance/`)
- Attendance members, sessions, manual adjustments, and yearly totals live in its own Cloudflare D1 database, bound as `ATTENDANCE_DB`.
- G3ID provides session identity and attendance leaderboard eligibility. The API serves the attendance kiosk and the G3ID admin summary/leaderboard.
- The schema is in `src/db/migrations/`. Apply migrations and import existing attendance records before deploying a worker that reads D1. Production D1 is `g3-attendance-prod`.
- Run `pnpm --filter @g3/worker-attendance test` for Cloudflare runtime tests against a local migrated D1 database.

### G3 Edge (shop network box)

Design brief: `docs/edge.md`. On-site Orange Pi 5 (hostname `orangepi5`, login user `g3`) routes the shop LAN through a 50 GB/month cellular hotspot.
- `devices/edge-agent` (Bun + Hono, binds 127.0.0.1): `src/core/*` + feature modules in `src/modules/<name>/`. The network module reads nftables `inet acct` counters every 5 min, attributes bytes by MAC, buffers in local SQLite, and pushes to the worker. Per-site stats: `flows_dl`/`flows_ul` nft sets (client . remote IP) plus the dnsmasq query log (`/run/g3-edge-dns/queries.log`) map bytes to domains; hourly top-20 sites per device are pushed. The agent deletes idle entries from the flows sets (its only write to `inet acct`).
- `workers/edge`: `/agent/*` routes use a shared bearer key (`EDGE_AGENT_KEY`); UI routes use G3ID (`isAdmin` required for writes). Modules live in `src/modules/<name>/`. Daily cron rolls 5-min usage into hourly rows after 14 days.
- `apps/edge`: plugin-based UI; nav items are grouped by module.
- Agent and app both use Hono RPC types from `@g3/worker-edge` (no shared schema package).
- **Site data is admin-only** in both the worker and the UI (it is per-student browsing data). Hourly rows kept 30 days, then daily for a year.
- **Blocking (Phase 2):** admin-made blocklists, time-limited grants, and UI switches (`enforce`, `dns_hardening`) live in D1; every change bumps `net_settings.state_version` and pokes the agent (`POST /sync` via the tunnel, `EDGE_AGENT_URL`). The agent fetches `GET /agent/network/state`, applies it to its own `inet g3` table and `/var/lib/g3-edge/dnsmasq/g3-edge.conf` (built in `devices/edge-agent/src/modules/network/enforce.ts`), and acks. The UI shows "pending" until the applied version matches. Enforcement survives offline and reboots (last state saved in agent.db).
- **Single edge device, no HMAC, no Cloudflare Access, no SSH through the tunnel** (SSH on `wan0` is temporarily allowed by a `# TEMP` rule in `nftables.conf`). The agent never touches base netplan, nftables, or dnsmasq config; `nftables.conf` must not `flush ruleset` (it would delete `inet g3`). `POST /sync` and module routes (`/print/*`, `/lookup`, `/switch/*`) require the shared key; `/health` is local-only (the tunnel forwards only `^/(print|lookup|switch|sync)`).
- **Printing:** replaces the old shoppi-print server. Shop worker `/print` (unchanged API; forces one-sided black and white) → `EDGE` service binding → edge worker `/print/*` → `agentFetch` (`EDGE_AGENT_URL` + `EDGE_AGENT_KEY`, through the tunnel) → agent `modules/print` → CUPS (`lp`/`lpadmin` to change things, a small IPP client in `ipp.ts` to read printers and jobs). **Nothing is stored**: no R2, no job table; CUPS on the box is the source of truth, and an unreachable box is an immediate 503. Anyone logged in can print; admins manage printers; members cancel only their own jobs (jobs are submitted with `lp -U <G3ID user id>`). Wire types live in `workers/edge/src/modules/print/types.ts`, exported as `@g3/worker-edge/print-types`. The agent needs to be in the `lpadmin` group.
- **Shop drive:** `devices/edge-agent/src/modules/drive` runs its own HTTP server on the box's LAN address, port 80 (`http://drive.local`, announced over mDNS by `g3-drive-mdns.service`; also `http://192.168.50.1`). It's a self-contained page plus `/api/files` and `/files/:name` (Range downloads). **No auth, by design**: anyone on the LAN can upload, download, and delete low-risk files. It's never exposed through the tunnel, so file traffic never crosses the internet. Storage is a 10 GB loop-mounted image at `/srv/g3-drive` (`infra/edge/setup-drive.sh`); the agent refuses to write if it isn't mounted. The dashboard's Drive page only links there: an https page can't call a plain-http LAN address.
- **Door sounds:** `devices/edge-agent/src/modules/switch` reads the Orange Pi 5's GPIO2_D4 (physical pin 22 / GPIO 92). The door-closed microswitch grounds the pulled-up input; the opening transition plays a WAV through `aplay` to the BlueALSA Bluetooth PCM (`EDGE_SWITCH_AUDIO_DEVICE`, default `bluealsa`). Admin-only `/switch/*` worker routes and the Edge app's Door Sounds page manage, test, and delete WAV files stored on the box in `/srv/g3-sounds`; audio is not stored in Cloudflare.
- Local dev: `pnpm --filter @g3/edge-agent run dev:mock` runs the agent with fake counters against the local worker (copy `workers/edge/.dev.vars.example` to `.dev.vars`).

### G3 Orders (parts ordering)

- Any member requests one line (vendor link, quantity, budget category, reason). **Only G3ID mentors and site admins** (`is_mentor` or `is_admin`, never kiosk sessions) approve/deny, mark ordered (with actual cost) and manage budget categories. Statuses: requested → approved/denied → ordered → received, or cancelled (requester or mentor, before ordering). The requester can also mark their own order received.
- `workers/orders` (Hono, Drizzle, D1 `ORDERS_DB`): `/requests` (list, detail with history, create, edit while requested, `POST /requests/:id/:action`), `/categories` (with spent/committed/pending totals), `/lookup?url=` (7-day cache in `lookup_cache`). Status changes are conditional updates on the expected status, and every change is logged in `request_events`.
- Approval sends the requester a Slack DM (`SLACK_BOT_TOKEN`, optional); their Slack ID is captured from their G3ID identities when they submit.
- Part lookup runs **on the edge box** so vendors see the shop connection, not a Workers IP: orders `/lookup` → `EDGE` service binding → edge worker `/lookup` → `agentFetch` → agent `modules/lookup/part-lookup.ts` (Shopify, including the linked products behind Itoris "Dynamic Product Options" dropdowns on placeholder products like WCP's Tube Plugs, BigCommerce, JSON-LD, Amazon, DigiKey API via `EDGE_DIGIKEY_*` in agent.env). The requester's browser headers (User-Agent, Accept-Language, Sec-CH-UA; never cookies) are forwarded for fetches that must look like a browser (Amazon); Shopify gets an honest user agent because a fake Chrome one gets 429s. McMaster's API is B2B-only, so McMaster links only yield the part number (and name when prerendered). Wire types: `@g3/worker-edge/lookup-types`. Box offline → lookup fails with 503 (no fallback); requesters can fill details by hand. The agent meters lookup traffic (compressed wire bytes + headers, via `fetch` with `decompress: false`) into the network usage buckets under the pseudo-client `_lookup`; the Network overview shows it as "Part lookups". Usage keys starting with `_` are never LAN clients. Local dev: run the mock agent (`pnpm --filter @g3/edge-agent run dev:mock`) and copy `workers/edge/.dev.vars.example` to `.dev.vars` (its key matches `mock.env`); without it lookups fail with 502 "rejected the worker's key".
- `apps/orders`: plugin-based UI (from `apps/edge`): New Request, Requests, Approvals (mentors; "Replace item" swaps in another link through the same lookup as New Request (`plugins/requests/draft.tsx`), keeping quantity, category, priority, need-by and reason; logged as a `replaced` event with the old item), Ordering (mentors: approved lines grouped by vendor; `POST /requests/order-batch` marks many ordered and splits an optional real order total across them by estimate), Budget.
- Money: only placed vendor orders count against budgets (final qty × price, or an imported line's exact `line_total_cents`, plus the order's fee rows in `order_charges`: Shipping/Tax/Tariff per category; new orders split fees by item cost). `GET /orders/export.csv` writes the team's order-sheet columns; `POST /orders/import` (Budget page, `?dryRun=1` previews) reads the same format back, matching Budget Cat codes to categories and skipping rows imported before (`import_key`).
- Fiscal years run July–June (`src/lib/fiscal.ts`, named by starting year: 2026 = "2026–27"). Budgets are per category per year (`category_budgets`); spending counts in the year an order was placed. The Budget page has a year picker and the team's summary table; exports are per year.
- Vendors are matched by lowercased name (`vendors` table holds profiles: tax exemption, shipping thresholds, minimum, lead/shipping days, cutoff, payment, credits in `vendor_credits`). Students only get lead/shipping days (for place-by dates). The Ordering tab shows profile nudges and marks carts with Blocking or late items "Place today". Requests have `priority` (blocking/high/normal/nice, anyone can set) and `need_by`; place-by = need-by − lead − shipping days.
- Fast entry: New Request takes several links at once; `POST /suggest` returns the templated name (`src/lib/naming.ts`, template in `app_settings`, default `{vendor} {sku} – {title}`), a budget-category guess (last purchase of the same product → vendor default → `category_rules` keywords, whole word) and "bought before" history (same Amazon ASIN / host+path, or same SKU at the vendor). For a part new to the catalog it also guesses the catalog category from light built-in keywords (`src/lib/category-guess.ts`, only categories that exist). Guessed values show an amber "check it's right" hint until the requester changes them. Mentors edit the template and keyword rules on the Settings page.
- Receiving page: `GET /orders/receiving` (orders with items on the way + received in the last 14 days), `POST /orders/receive` (mentors anything, others their own requests), `PATCH /orders/:id/tracking` (mentors). Tracking links guess the carrier from the number.
- One-click carts: Shopify cart permalinks (`apps/orders/src/shared/cart.ts`: `/cart/<variant>:<qty>,…`, variant from `store_variant_id` saved at request time or `?variant=` in the link) and, for Amazon only, Share-A-Cart (`workers/orders/src/lib/share-a-cart.ts`: the team's account connected once on Settings over OAuth, carts saved through their MCP `sac_save_cart` tool). Other stores' Share-A-Cart carts need the browser extension and McMaster's don't work, so REV, McMaster, DigiKey and the rest stay manual.
- Catalog (`/catalog`, Catalog tab): anyone logged in browses and requests; only mentors and **trusted students** add categories (`catalog_categories`) and add, edit or delete parts (`requireCatalogEditor`). Mentors mark trusted students on Settings (`/trusted`; `app_users` lists everyone who has opened G3 Orders, recorded by `GET /me`, which also returns `canEditCatalog`). A part new to the catalog must go in an existing category. `catalog_families` + `catalog_items` (vendor, SKU, `options` JSON of size/type choices, link with `link_kind` product/search/homepage, `product_key` for matching). Seeded once from the FRCDesign library export (`scripts/catalog-seed.py` → migration `0010_catalog_seed.sql`; rows without a link left out), then relinked from each vendor's own product list (`scripts/catalog-relink.py` → `0012_catalog_links.sql`: Shopify `/products.json`, REV's storefront GraphQL, SWYFT's sitemap; matched by part number, pack suffix ignored, then strictly by name; run from a dev machine, not the edge box). VEXpro parts were dropped: VEX no longer sells the line, and the parts still made are in the catalog under WCP/AndyMark/CTRE. The app loads the whole catalog and searches in the browser (`apps/orders/src/plugins/catalog/search.ts`: MiniSearch, fractions/decimals/thread sizes normalized, typos allowed in words, not numbers). Each part's Request button opens New Request with `?catalog=<id>`. Reusable search box: `CatalogSearch` (`plugins/catalog/catalog-search.tsx`, catalog loaded once and shared via `catalog-data.ts`), used by Replace item and New Request. Every submitted request gets `catalog_item_id` (`src/lib/catalog.ts` `catalogItemFor`): the picked item (which takes the requester's product link if it only had a search/homepage link), the item with the same link + Shopify option, or a new item; a link new to the catalog needs a catalog category or the request is rejected. Prices come only from placed orders (`price_cents`/`price_at`); after 7 days a catalog pick is looked up again instead of using the saved price.
- Lists (`/lists`, `workers/orders/src/routes/lists.ts`, migration `0014_part_lists.sql`): named groups of requests (`part_lists` + `part_list_items`; a request can be on several lists). Anyone logged in makes lists and adds/removes requests; only the creator or a mentor renames, archives or deletes one (requests are never touched). Each list reports counts per status (awaiting approval → approved → ordered → arrived; denied/cancelled left out of progress) and cost. Parts get onto a list by `POST /requests` with `listId` (New Request's List picker, preset by `/new?list=`; the Catalog passes `?list=` through to its Request buttons), `POST /lists/:id/items` (Add existing requests), or a request page's Lists card. The list page's fuzzy find (`apps/orders/src/plugins/lists/search.ts`) reuses the catalog's MiniSearch tokenizer, so sizes, typos, SKUs, people and statuses all match.
- Lookup errors: the agent answers 422 when a vendor's site blocks or fails (never 502, which `agentFetch` reads as "box unreachable"); orders shows "This site isn't supported for automatic lookup".

### Versions and releases

- **App versions**: SemVer, one per app, shared by its page and its worker (Changesets `fixed` groups in `.changeset/config.json`; the edge agent has its own). The worker's `package.json` is the source: `/health` returns it (`import packageJson from "../package.json"`), and apps get it through `siteConfig()` as `appVersion` / `versionLabel()` from `@g3/site-config/versions` (shown in the navbar's tooltip and drawer). Never hard-code a version.
- **Platform version**: CalVer `YEAR.MONTH.N` in the root `package.json`; each release and the app versions in it are listed in `RELEASES.md`.
- **Branches**: work merges into `main`; `public` is the released (and deployed) branch.
- **Every PR into main that changes an app adds a changeset** (`pnpm changeset`: pick the app, patch/minor/major, a summary for users; `--empty` when nothing should be released). CI fails a PR without one. Shared packages (`packages/*`) are ignored by Changesets; record their changes against the affected apps.
- **Agents: write the changeset file yourself** (`pnpm changeset` is interactive). When a commit changes an app, add `.changeset/<short-name>.md` in the same commit:
  ```md
  ---
  "@g3/worker-orders": minor
  ---

  One line for the app's users: what changed for them.
  ```
  List each changed app once, by its worker package (`@g3/worker-<app>`; Portal is `@g3/portal`, the edge agent `@g3/edge-agent`), with the bump from `.changeset/README.md`: **patch** for fixes and small tweaks, **minor** for new features that break nothing, **major** when users or deployers must act (a migration to run first, a removed page, a changed API). For changes that release nothing (docs, CI, tooling only), use an empty header (`---` then `---`). Say which bump you chose and why when you report the commit, so a person can check it; `pnpm release:preview` shows the resulting versions.
- **Releasing**: `.github/workflows/release-pr.yml` keeps one `main` → `public` PR open, titled with the next release (`pnpm release:preview`, which runs the release in a throwaway worktree). Merging it (merge commit only) runs `.github/workflows/release.yml` on `public`: applies the changesets (`pnpm release:version`: versions, CHANGELOG.md files, platform CalVer, RELEASES.md), commits "Release <platform>", tags `v<platform>` and each app's version (`pnpm release:tag`), and merges `public` back into `main`. It pushes with the `RELEASE_DEPLOY_KEY` deploy key, which is on both rulesets' bypass lists.

### Site config (team, domain)

- Everything team-specific lives in `packages/site-config/src/site.ts` (`@g3/site-config`): team number, name and short name ("G3"), the domain, each app's web/API subdomain, public links, the Slack bot's name. **Never hard-code the domain, team number or "G3" branding**: use `appUrl("shop")`, `apiUrl("orders")`, `allAppsUrl`, `wordmark("Shop")` ("G3 SHOP"), `appTitle("Shop")` ("G3 Shop"), `idName` ("G3ID"), `teamLinks`, `teamKey` ("frc1648"), `site.team.*`. Internal names (`@g3/*` packages, `g3_session`/`g3_theme` cookies, `--g3-*` CSS, `G3ID` binding, database names) stay as they are.
- CORS for every worker is `cors({ origin: corsOrigin })`: https on the domain and its subdomains, plus localhost. No `*.pages.dev`.
- Apps: `siteConfig()` from `@g3/site-config/vite` in each `vite.config` fills `%SITE_SHORT_NAME%`, `%SITE_TEAM_NAME%`, `%SITE_TEAM_NUMBER%`, `%SITE_ID_NAME%`, `%SITE_ALL_APPS_URL%`, `%SITE_APP_URL%` in `index.html`, and sets production API URLs (`productionEnv`), so there are no `.env.production` files; `.env.development` still points dev at localhost.
- Files that can't import it (`wrangler.toml` production URLs, routes, OAuth redirect URIs, `TEAM_NUMBER`; the edge env examples) are written by `pnpm configure` (`scripts/configure.ts`); CI runs `pnpm configure --check`.

### Shared navbar and light/dark mode

- Every app's top bar is `AppNavBar` from `@g3/ui` (`packages/ui/src/components/app-nav-bar.tsx`, styled by its own plain CSS in `nav-bar.css` so it renders the same in G3 Strategy, which doesn't use the shared Tailwind theme). Each app's `shared/nav-bar.tsx` is a thin wrapper: it filters pages by permission, marks the current one (`activePath`: the most specific link covering the URL), and passes react-router links via `linkWith(Link)`. Pages go in a drawer below 768px.
- Light/dark is one setting for all apps: the `g3_theme` cookie on `.g3robotics.com` (shared across ports on localhost), applied as `html[data-theme]` before first paint by a small script in each app's `index.html`; `useTheme`/`setTheme` (`packages/ui/src/theme.ts`) change it, and open tabs pick up a change on focus. No cookie → the system setting.
- One color scheme for every app (`packages/ui/src/colors.css`, G3 Strategy's): page `#f4f6f7` / dark `#171717`, surface (cards, top bar) `#ffffff` / `#262626`, inset `#eef1f3` / `#1e1e1e`, line, text, muted and accent, as `--g3-*` CSS variables that switch with the theme. Tailwind apps use them as `bg-page`, `bg-surface`, `bg-inset`, `border-line`; every page's root background is `bg-page`. Strategy's CSS uses `var(--g3-page)`. Skill Tree keeps its own look.
- Apps are styled light. Dark mode comes from `packages/ui/src/theme.css` + the generated `theme-palette.css`: neutral ramps (secondary, gray, slate, ...) invert, `bg-white`/`bg-paper` become dark panels, tinted backgrounds (`*-50..300`) become dark tints, and dark text shades (`text-*-600..950`) become light. Solid fills (`bg-*-500/600`) are unchanged. So write light-mode classes; use a hex value (`bg-[#24292f]`) only for a color that must not change in dark mode.

### Color Implementation

All colors defined in `packages/ui/src/index.css` `@theme` block:
- Primary palette (burgundy): primary-50 through primary-900
- Secondary palette (neutral grays): secondary-50 through secondary-900
- Used across all apps via Tailwind classes
- **Do not use hardcoded colors** — use the `@theme` palette

### Database Schema

Key tables in D1:
- `core_users` — user accounts with status (pending/active/rejected)
- `core_user_identities` — linked auth providers per user
- `core_sessions` — active sessions (deprecated in favor of KV)
- `core_user_pins` — 3-digit PINs for kiosk login
- `kiosk_devices` — registered shop devices with tokens
- `kiosk_activation_codes` — 6-digit codes for device activation (30-min expiry)
- `core_slack_link_codes` — Slack auth codes with polling status

Migrations are SQL files in `workers/g3id/src/db/migrations/` — always add new migrations for schema changes.

### Slack Integration

Three flows:
1. **Sign-in**: User runs `/signin 123456` with a code from the web app
2. **Link**: Authenticated user runs `/link 123456` to add Slack to their account
3. **Events**: Slack bot receives 6-digit codes via DM and processes them

Routes:
- `POST /slack/events` — Slack event API (URL verification, DM messages)
- `POST /slack/commands/signin` — `/signin` slash command
- `POST /slack/commands/link` — `/link` slash command
- `GET /auth/slack/initiate` — Start sign-in flow
- `GET /auth/slack/link` — Start linking flow
- `GET /auth/slack/status` — Poll for completion (frontend calls every 2s)

Rate limiting: 5 attempts per 15 minutes per Slack user (via KV).

### Kiosk System (Shop Devices)

PIN-based access for untrusted computers:
- 3-digit numeric PIN assigned per user
- Device activation via 6-digit code (admin-generated, 30-min expiry)
- Kiosk token stored in browser localStorage, validated on every request
- Sessions marked as `sessionType: 'pin'` to prevent admin access
- If token is invalid/revoked, app redirects to `/kiosk/activate`

## Common Tasks

**Add a new auth provider:**
1. Create route handler in `workers/g3id/src/routes/auth/<provider>.ts`
2. Export router and mount at `workers/g3id/src/index.ts` (line with `.route("/auth", ...)`)
3. Add login page/button to `apps/g3id/src/plugins/auth/`
4. Update NavBar filtering if needed

**Change colors:**
1. Edit `packages/ui/src/index.css` `@theme` block (primary-*/secondary-* only)
2. All apps auto-inherit via Tailwind configuration
3. Do not use hardcoded hex values in components

**Add admin feature:**
1. Add route to `workers/g3id/src/routes/admin.ts` (uses `requireAdmin` middleware)
2. **Remember**: PIN sessions will get 403 "Admin access not allowed from kiosk"
3. Protect via admin-only NavBar visibility

**Database schema change:**
1. Create migration file: `workers/g3id/src/db/migrations/000X_description.sql`
2. Update `workers/g3id/src/db/schema.ts` Drizzle definitions
3. Test locally: `wrangler d1 migrations apply <database-name> --local`

**Create dev accounts with email/password (as admin):**
```
GET http://localhost:8787/auth/dev/create-user?email=test@example.com&password=password123&name=TestUser
```
- Requires admin authentication (logged in as admin)
- Development environment only
- Query params: `email` (required), `password` (required, 8+ chars), `name` (optional, defaults to email prefix)
- Creates an active user immediately (no approval needed)
- New user can log into any app with their email/password

## Testing & Validation

**Before committing:**
```bash
pnpm biome check --write      # Fix all linting issues
pnpm -r --if-present typecheck  # Ensure TypeScript passes
pnpm -r --if-present test    # Run available tests
```

**Worker tests** (`pnpm --filter @g3/worker-orders test`, or `pnpm test` for everything; CI runs them on every PR):
- Every worker has `vitest.config.mts` (`.mts`: the Workers test pool needs ESM) built by `workerTestConfig` from `packages/testing` (`@g3/testing`). Tests run inside the Workers runtime via `@cloudflare/vitest-pool-workers` (pinned in the pnpm catalog: Vitest 4.1.x only) against local D1/KV/R2 from the worker's wrangler config, with its D1 migrations applied before each test file (`packages/testing/src/setup.ts`). No Cloudflare account or secrets: `remoteBindings` is off, and tests must not rely on `.dev.vars`.
- Storage is per test file, shared by the tests in a file, so each test makes its own records (random URLs, generated PINs) instead of assuming an empty database.
- Other workers are stubbed: `G3ID` is a stub that answers `/auth/me` for the user in a test cookie (never admin/mentor for a `pin` session, like the real one), and other services (e.g. `EDGE`) can be `offlineService`. In tests, `callAs(student, "/path", { method, body })` / `jsonAs(...)` from `@g3/testing/worker` sign requests in as the users in `@g3/testing/users` (`student`, `otherStudent`, `mentor`, `admin`, `kioskAdmin`).
- G3ID itself is tested for real (`workers/g3id/test`): users and sessions are seeded with its own helpers (`createUser`, `sessionCookie`, `createUserWithPin`, `activateKiosk`).
- Attendance's records are in Firestore, which tests don't reach; only its auth and kiosk-code checks are covered.

**Test Slack locally:**
- Sign-in codes generated and stored in D1
- Frontend polls `/auth/slack/status` every 2s
- Status persists in D1 (immediate, not KV eventual consistency)

**Test kiosk flow:**
- Admin generates 6-digit activation code
- Device enters code at `/kiosk/activate`
- Receives kiosk token, stores in localStorage
- PIN login at `/kiosk/login` requires valid token in header

## Development Servers

**Port assignments** (configured in `.dev-ports.json` and individual vite/wrangler configs):

Apps:
- `apps/g3id` → 5173
- `apps/shop` → 5174
- `apps/pit` → 5175
- `apps/portal` → 5178
- `apps/skill-tree` → 5180
- `apps/attendance` → 5181
- `apps/scouting` → 5182
- `apps/edge` → 5183
- `apps/orders` → 5184

Workers (Wrangler):
- `workers/g3id` → 8787 (inspector: 9229)
- `workers/shop` → 8788 (inspector: 9230)
- `workers/pit` → 8789 (inspector: 9231)
- `workers/skill-tree` → 8790 (inspector: 9232)
- `workers/attendance` → 8791 (inspector: 9233)
- `workers/scouting` → 8792 (inspector: 9234)
- `workers/edge` → 8793 (inspector: 9235)
- `workers/orders` → 8794 (inspector: 9236)
- `devices/edge-agent` (mock) → 8700

**Starting dev servers:**
- `pnpm dev` — Start all servers and print port summary after ready
- `pnpm dev:silent` — Start all servers without port printer

**Port conflicts:**
If you see "Address already in use" errors, kill zombie processes:
```bash
fuser -k 8787 8788 8789 8790 8791 9229 9230 9231 9232 9233
# or more aggressively:
killall -9 workerd wrangler node
```

**Adding a new port:**
1. Update the app/worker vite.config.ts or wrangler.toml with the new port
2. Add entry to `.dev-ports.json` in the appropriate section (apps or workers)
3. The port printer will automatically pick it up on next `pnpm dev`

## Adding New Apps and Workers

**Add a new app (React frontend):**
1. Create directory: `apps/<app-name>/`
2. Copy structure from an existing app (e.g., `apps/portal/`)
3. Add unique port to `apps/<app-name>/vite.config.ts` (check `.dev-ports.json` for available ports)
4. Create `apps/<app-name>/package.json` with at minimum: `name`, `type: "module"`, `dev` script
5. Update `.dev-ports.json` with the new app and port
6. Add to root `pnpm-workspace.yaml` if not already globbed

**Add a new worker (Cloudflare backend):**
1. Create directory: `workers/<worker-name>/`
2. Copy structure from an existing worker (e.g., `workers/shop/`)
3. Add unique port and inspector-port to `workers/<worker-name>/wrangler.toml`
4. Set up D1 database bindings and KV namespace bindings in wrangler.toml
5. Create `workers/<worker-name>/package.json` with `name` and `dev` script
6. Update `.dev-ports.json` with the new worker, port, and inspectorPort
7. Add to root `pnpm-workspace.yaml` if not already globbed
8. If the worker needs to call other services, add service bindings in wrangler.toml

**Key differences from other systems:**
- Apps use Vite for dev server and build
- Workers use Wrangler for local dev (runs actual Cloudflare workerd runtime)
- All use Tailwind CSS v4 for styling (via `@g3/ui` package)
- All use TypeScript; monorepo-wide `pnpm typecheck` validates all

## Deployment

Workers deployed via Wrangler:
- `wrangler deploy` in each worker directory
- D1 database migrations run on deploy (see `wrangler.toml` in worker directories)
- Frontend apps deployed to Cloudflare Pages (via GitHub Actions)

## Key Files to Know

- `workers/g3id/src/middleware/auth.ts` — G3ID's own auth middleware (requireAuth, requireAdmin, requireKioskToken)
- `packages/auth/src/g3id.ts` — Sign-in for every other worker (`@g3/auth`: requireAuth, requireAdmin, requireMentor, requireOAuthSession, `G3AuthVariables`); app-specific checks (Edge's agent key, Orders' catalog editors, Scouting's local bypass) stay in that worker's `middleware/auth.ts`
- `workers/g3id/src/routes/auth/slack.ts` — Slack OAuth flow endpoints
- `workers/g3id/src/routes/slack.ts` — Slack slash commands and events
- `workers/g3id/src/lib/slack-code.ts` — Core Slack authentication logic
- `apps/g3id/src/shared/nav-bar.tsx` — Navigation bar with auth state management
- `packages/ui/src/index.css` — Tailwind theme and colors

## Updating This File

**When to update CLAUDE.md:**
- Major architectural changes (new systems, refactors)
- New common workflows or troubleshooting patterns emerge
- Database schema structure changes significantly
- New authentication flows added
- Color palette or styling approach changes
- Route structure or middleware patterns change

**How to update:**
1. Keep Architecture Overview in sync with actual code
2. Add new systems under "Key Systems" if they span multiple files
3. Document new auth flows in the Slack Integration / Kiosk System sections
4. Update Common Tasks if the process changes
5. Link to specific files when they're the source of truth
6. Remove outdated information — don't archive old systems

**Update checklist:**
- [ ] Verify all routes/paths still exist
- [ ] Check database schema reflects reality
- [ ] Ensure commands work as documented
- [ ] Validate color/theme documentation matches code
