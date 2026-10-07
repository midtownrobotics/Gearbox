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

## Platform Roadmap (read this first)

These apps are being turned from one team's tools into a hosted platform that many teams share. The plan of record is `docs/roadmap/roadmap.md`. **Before changing code, read its Progress section and the phase your change touches**, so the change moves toward the plan instead of away from it.

**Rules that follow from the roadmap:**
- **No new team-specific values in code, config or migrations**: team name, number, domain, Slack channel IDs, time zone, currency, event keys. Read them from `@g3/site-config` (see "Site config" below), which becomes per-team data in Phase 2.
- **No new single-team assumptions in schemas**: no `CHECK (id = 1)` settings rows, and no key that is unique across the whole table when it should be unique per team (a vendor key, a setting name, a PIN). New tables for a team's data should be easy to scope with a `team_id` later (Phase 3).
- **Sign-in and roles only through `@g3/auth`**. App workers don't read the session cookie themselves; in Phase 2 a gateway hands them the user and team.
- **Core apps must not depend on Edge.** Edge is G3's own single-team app. Orders part lookup and Shop printing treat it as an optional provider and must keep working (by hand) without it.
- **Hosting and deploy changes need the owners' yes first**: a new Cloudflare product, a paid add-on, a new vendor or a new domain. The roadmap's "Hosting and stack decisions" section lists what is already confirmed; ask before going beyond it.
- **Features that change what data is collected, how long it's kept or who can see it** must match the drafts in `docs/legal/` (Terms of Service, Privacy Policy). Update the draft in the same PR, or say in the PR that it needs a decision.

**Keep the roadmap current.** When a change completes or advances a step, update `docs/roadmap/roadmap.md` in the same PR: the step's Status, the Progress table, and a row in "What landed". If a change makes part of the plan wrong, fix the plan there and say so in the PR description. A roadmap-only change takes an empty changeset.

## Repository Structure

**Monorepo using pnpm workspaces:**

- `apps/` — React frontends (g3id, portal, shop, pit, skill-tree, attendance, scouting, edge, orders, inventory, platform)
- `workers/` — Cloudflare Workers: one per app (g3id, portal, shop, pit, skill-tree, attendance, scouting, edge, orders, inventory, platform), each serving its app's page and its API at `/api`, plus `gateway`, which routes `*.<domain>` to them
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

### Optional Scouting engagement

- Scouting points and match predictions are off by default. Identity admins configure them on Scouting's Admin page; Strategy leads and kiosk PIN sessions cannot change these controls.
- `workers/scouting/src/engagement.ts` reads team-keyed D1 settings. `/scouting/me` includes the settings; `/scouting/engagement-settings` reads them and accepts admin-only PUT updates. Predictions, combined picks and team standings have separate switches, and the points label defaults to "Scout Points".
- The master switch gates `/game`, point awards on scouting submissions, and scheduled prediction result processing. Disabling predictions alone also pauses result processing. Existing balances and picks are preserved; existing combined picks still resolve when predictions resume even if new combinations are disabled.
- Apply migration `0032_engagement_settings.sql` before deploying this code. Existing game table names and API payload keys are retained for compatibility. The team key currently comes from site config and must move to verified team context during the tenancy migration.
- `workers/scouting/test/engagement.test.ts` covers defaults, admin permissions, API gates, standings visibility and scouting awards.

### G3 Edge (shop network box)

Design brief: `docs/edge.md`. On-site Orange Pi 5 (hostname `orangepi5`, login user `g3`) routes the shop LAN through a 50 GB/month cellular hotspot.
- `devices/edge-agent` (Bun + Hono, binds 127.0.0.1): `src/core/*` + feature modules in `src/modules/<name>/`. The network module reads nftables `inet acct` counters every 5 min, attributes bytes by MAC, buffers in local SQLite, and pushes to the worker. Per-site stats: `flows_dl`/`flows_ul` nft sets (client . remote IP) plus the dnsmasq query log (`/run/g3-edge-dns/queries.log`) map bytes to domains; hourly top-20 sites per device are pushed. The agent deletes idle entries from the flows sets (its only write to `inet acct`).
- `workers/edge`: `/agent/*` routes use a shared bearer key (`EDGE_AGENT_KEY`); UI routes use G3ID (`isAdmin` required for writes). Modules live in `src/modules/<name>/`. Daily cron rolls 5-min usage into hourly rows after 14 days.
- `apps/edge`: plugin-based UI; nav items are grouped by module.
- Agent and app both use Hono RPC types from `@g3/worker-edge` (no shared schema package).
- **Who's online:** the network module also tracks presence from the LAN's neighbor (ARP) table (`modules/network/presence.ts`): every 30 s it sends each known address (leases + table) an empty UDP datagram so the kernel ARPs it, and a MAC that was REACHABLE in the last 2 minutes counts as online, so printers and other LAN-only devices show up too. The Clients page asks live on each load: worker `GET /network/clients` (and `/clients/:mac`) → `agentFetch("/network/presence")` over the link → `{ online }` per client, and it upserts online devices into `net_clients`. Box unreachable → the list still loads with `online: null` and a note. Wire types: `@g3/worker-edge/presence-types`. The Edge Box page's Addresses card reads the box's own LAN/WAN addresses the same way (worker `GET /status/interfaces` → agent `GET /network/interfaces`, `ip -j addr`; `@g3/worker-edge/interface-types`). Its public address is stored, not live: `requireAgent` records `CF-Connecting-IP` from each agent upload in `edge_status.public_ip` (+ `public_ip_since`, when it last changed; migration `0004`).
- **Site data is admin-only** in both the worker and the UI (it is per-student browsing data). Hourly rows kept 30 days, then daily for a year.
- **Blocking (Phase 2):** admin-made blocklists, time-limited grants, and UI switches (`enforce`, `dns_hardening`) live in D1; every change bumps `net_settings.state_version` and pokes the agent (`POST /sync` over the link). The agent fetches `GET /agent/network/state`, applies it to its own `inet g3` table and `/var/lib/g3-edge/dnsmasq/g3-edge.conf` (built in `devices/edge-agent/src/modules/network/enforce.ts`), and acks. The UI shows "pending" until the applied version matches. Enforcement survives offline and reboots (last state saved in agent.db).
- **The link (no tunnel):** the worker reaches the box over one WebSocket the agent opens and keeps open (`devices/edge-agent/src/core/link.ts` → `wss://<edge>/api/agent/connect` with `EDGE_AGENT_KEY`), held by the `AgentLink` Durable Object (`workers/edge/src/lib/agent-link.ts`, SQLite-backed, hibernating; one box, so one instance). `agentFetch(env, path, init)` sends an HTTP request down it; the agent runs it on its own API (`createAgentApp` in `core/server.ts`) with the key added and streams the answer back. Frames (`src/lib/link-protocol.ts`, `@g3/worker-edge/link-protocol`) are a 4-byte header length + JSON header + body bytes, bodies in 256 KiB pieces (print jobs reach 50 MB; a WebSocket message can't). Heartbeat: the agent sends `ping` every 25 s, the Durable Object auto-answers `pong` without waking, and the agent reconnects (backoff to 60 s) after two missed answers or any close. Box not connected or too slow → `AgentError` 503. `/status/connection` checks it. Nothing on the box listens on the internet.
- **Single edge device, no HMAC, no Cloudflare Access, no SSH from the internet** (SSH on `wan0` is temporarily allowed by a `# TEMP` rule in `nftables.conf`). The agent never touches base netplan, nftables, or dnsmasq config; `nftables.conf` must not `flush ruleset` (it would delete `inet g3`). The agent's API (`POST /sync`, `/print/*`, `/lookup`, `/switch/*`, `/network/*`) requires the shared key; it's also served on 127.0.0.1:8700 for checks on the box, where `/health` needs none.
- **Printing:** replaces the old shoppi-print server. Shop worker `/print` (unchanged API; forces one-sided black and white) → `EDGE` service binding → edge worker `/print/*` → `agentFetch` (over the link) → agent `modules/print` → CUPS (`lp`/`lpadmin` to change things, a small IPP client in `ipp.ts` to read printers and jobs). **Nothing is stored**: no R2, no job table; CUPS on the box is the source of truth, and an unreachable box is an immediate 503. Anyone logged in can print; admins manage printers; members cancel only their own jobs (jobs are submitted with `lp -U <G3ID user id>`). Wire types live in `workers/edge/src/modules/print/types.ts`, exported as `@g3/worker-edge/print-types`. The agent needs to be in the `lpadmin` group.
- **Shop drive:** `devices/edge-agent/src/modules/drive` runs its own HTTP server on the box's LAN address, port 80 (`http://drive.local`, announced over mDNS by `g3-drive-mdns.service`; also `http://192.168.50.1`). It's a self-contained page plus `/api/files` and `/files/:name` (Range downloads). **No auth, by design**: anyone on the LAN can upload, download, and delete low-risk files. It's never reachable over the link, so file traffic never crosses the internet. Storage is a 10 GB loop-mounted image at `/srv/g3-drive` (`infra/edge/setup-drive.sh`); the agent refuses to write if it isn't mounted. The dashboard's Drive page only links there: an https page can't call a plain-http LAN address.
- **Door sounds:** `devices/edge-agent/src/modules/switch` reads the Orange Pi 5's GPIO2_D4 (physical pin 22 / GPIO 92). The door-closed microswitch grounds the pulled-up input; the opening transition plays a WAV through `aplay` to the Orange Pi 5 analog headphone jack (`EDGE_SWITCH_AUDIO_DEVICE`, default `plughw:CARD=rockchipes8388,DEV=0`). Admin-only `/switch/*` worker routes and the Edge app's Door Sounds page manage, test, and delete WAV files stored on the box in `/srv/g3-sounds`; audio is not stored in Cloudflare.
- Local dev: `pnpm --filter @g3/edge-agent run dev:mock` runs the agent with fake counters against the local worker, and opens its link to it (copy `workers/edge/.dev.vars.example` to `.dev.vars`). The agent logs `[link] connected to the worker`; its `/health` shows `link`.

### G3 Orders (parts ordering)

- Any member requests one line (vendor link, quantity, budget category, reason). **Only G3ID mentors and site admins** (`is_mentor` or `is_admin`, never kiosk sessions) approve/deny, mark ordered (with actual cost) and manage budget categories. Statuses: requested → approved/denied → ordered → received, or cancelled (requester or mentor, before ordering). **Anyone signed in** (kiosk sessions too) marks an ordered request received: packages are opened by whoever is in the shop.
- `workers/orders` (Hono, Drizzle, D1 `ORDERS_DB`): `/requests` (list, detail with history, create, edit while requested, `POST /requests/:id/:action`), `/categories` (with spent/committed/pending totals), `/lookup?url=` (7-day cache in `lookup_cache`). Status changes are conditional updates on the expected status, and every change is logged in `request_events`.
- Approval sends the requester a Slack DM (`SLACK_BOT_TOKEN`, optional); their Slack ID is captured from their G3ID identities when they submit.
- Part lookup runs **on the edge box** so vendors see the shop connection, not a Workers IP: orders `/lookup` → `EDGE` service binding → edge worker `/lookup` → `agentFetch` → agent `modules/lookup/part-lookup.ts` (Shopify, including the linked products behind Itoris "Dynamic Product Options" dropdowns on placeholder products like WCP's Tube Plugs, BigCommerce, JSON-LD, Amazon, DigiKey API via `EDGE_DIGIKEY_*` in agent.env). The requester's browser headers (User-Agent, Accept-Language, Sec-CH-UA; never cookies) are forwarded for fetches that must look like a browser (Amazon); Shopify gets an honest user agent because a fake Chrome one gets 429s. McMaster's API is B2B-only, so McMaster links only yield the part number (and name when prerendered). Wire types: `@g3/worker-edge/lookup-types`. Box offline → lookup fails with 503 (no fallback); requesters can fill details by hand. The agent meters lookup traffic (compressed wire bytes + headers, via `fetch` with `decompress: false`) into the network usage buckets under the pseudo-client `_lookup`; the Network overview shows it as "Part lookups". Usage keys starting with `_` are never LAN clients. Local dev: run the mock agent (`pnpm --filter @g3/edge-agent run dev:mock`) and copy `workers/edge/.dev.vars.example` to `.dev.vars` (its key matches `mock.env`); without it the worker refuses the agent's link and lookups fail with 503 "isn't connected".
- `apps/orders`: plugin-based UI (from `apps/edge`): New Request, Requests, Approvals (mentors; "Replace item" swaps in another link through the same lookup as New Request (`plugins/requests/draft.tsx`), keeping quantity, category, priority, need-by and reason; logged as a `replaced` event with the old item), Ordering (mentors: approved lines grouped by vendor; `POST /requests/order-batch` marks many ordered and splits an optional real order total across them by estimate), Budget.
- Money: only placed vendor orders count against budgets (final qty × price, or an imported line's exact `line_total_cents`, plus the order's fee rows in `order_charges`: Shipping/Tax/Tariff per category; new orders split fees by item cost). `GET /orders/export.csv` writes the team's order-sheet columns; `POST /orders/import` (Budget page, `?dryRun=1` previews) reads the same format back, matching Budget Cat codes to categories and skipping rows imported before (`import_key`).
- Fiscal years run July–June (`src/lib/fiscal.ts`, named by starting year: 2026 = "2026–27"). Budgets are per category per year (`category_budgets`); spending counts in the year an order was placed. The Budget page has a year picker and the team's summary table; exports are per year.
- Vendors are matched by lowercased name (`vendors` table holds profiles: tax exemption, shipping thresholds, minimum, lead/shipping days, cutoff, payment, credits in `vendor_credits`). Students only get lead/shipping days (for place-by dates). The Ordering tab shows profile nudges and marks carts with Blocking or late items "Place today". Requests have `priority` (blocking/high/normal/nice, anyone can set) and `need_by`; place-by = need-by − lead − shipping days.
- Fast entry: New Request takes several links at once; `POST /suggest` returns the templated name (`src/lib/naming.ts`, template in `app_settings`, default `{vendor} {sku} – {title}`), a budget-category guess (last purchase of the same product → vendor default → `category_rules` keywords, whole word) and "bought before" history (same Amazon ASIN / host+path, or same SKU at the vendor). For a part new to the catalog it also guesses the catalog category from light built-in keywords (`src/lib/category-guess.ts`, only categories that exist). Guessed values show an amber "check it's right" hint until the requester changes them. Mentors edit the template and keyword rules on the Settings page.
- Receiving page: `GET /orders/receiving` (orders with items on the way + received in the last 14 days), `POST /orders/receive` (anyone signed in), `PATCH /orders/:id/tracking` (mentors). Tracking links guess the carrier from the number.
- One-click carts: Shopify cart permalinks (`apps/orders/src/shared/cart.ts`: `/cart/<variant>:<qty>,…`, variant from `store_variant_id` saved at request time or `?variant=` in the link) and, for Amazon only, Share-A-Cart (`workers/orders/src/lib/share-a-cart.ts`: the team's account connected once on Settings over OAuth, carts saved through their MCP `sac_save_cart` tool). Other stores' Share-A-Cart carts need the browser extension and McMaster's don't work, so REV, McMaster, DigiKey and the rest stay manual.
- Catalog (`/catalog`, Catalog tab): anyone logged in browses and requests; only mentors and **trusted students** add and remove categories (`catalog_categories`; `DELETE /catalog/categories` moves the category's parts and families to another one first, in one batch) and add, edit or delete parts (`requireCatalogEditor`). Mentors mark trusted students on Settings (`/trusted`; `app_users` lists everyone who has opened G3 Orders, recorded by `GET /me`, which also returns `canEditCatalog`). A part new to the catalog must go in an existing category. `catalog_families` + `catalog_items` (vendor, SKU, `options` JSON of size/type choices, link with `link_kind` product/search/homepage, `product_key` for matching). Seeded once from the FRCDesign library export (`scripts/catalog-seed.py` → migration `0010_catalog_seed.sql`; rows without a link left out), then relinked from each vendor's own product list (`scripts/catalog-relink.py` → `0012_catalog_links.sql`: Shopify `/products.json`, REV's storefront GraphQL, SWYFT's sitemap; matched by part number, pack suffix ignored, then strictly by name; run from a dev machine, not the edge box). Stock material (shafts, tube, spline, extrusion, gear rack) was modelled in the library at a CAD preset length ("1/2\" Hex Lite (1\" L)"); `scripts/catalog-stock-lengths.py` → `0015_catalog_stock_lengths.sql` puts in the vendor's stock length instead (36", 47", 4ft, 480mm), or drops the length when the vendor sells several (AndyMark) or has no listing. Each update applies only while the item is still as seeded. VEXpro parts were dropped: VEX no longer sells the line, and the parts still made are in the catalog under WCP/AndyMark/CTRE. The app loads the whole catalog and searches in the browser (`apps/orders/src/plugins/catalog/search.ts`: MiniSearch, fractions/decimals/thread sizes normalized, typos allowed in words, not numbers). Each part's Request button opens New Request with `?catalog=<id>`. Reusable search box: `CatalogSearch` (`plugins/catalog/catalog-search.tsx`, catalog loaded once and shared via `catalog-data.ts`), used by Replace item and New Request. Every submitted request gets `catalog_item_id` (`src/lib/catalog.ts` `catalogItemFor`): the picked item (which takes the requester's product link if it only had a search/homepage link), the item with the same link + Shopify option, or a new item; a link new to the catalog needs a catalog category or the request is rejected. Prices come only from placed orders (`price_cents`/`price_at`); after 7 days a catalog pick is looked up again instead of using the saved price.
- Lists (`/lists`, `workers/orders/src/routes/lists.ts`, migration `0014_part_lists.sql`): named groups of requests (`part_lists` + `part_list_items`; a request can be on several lists). Anyone logged in makes lists and adds/removes requests; only the creator or a mentor renames, archives or deletes one (requests are never touched). Each list reports counts per status (awaiting approval → approved → ordered → arrived; denied/cancelled left out of progress) and cost. Parts get onto a list by `POST /requests` with `listId` (New Request's List picker, preset by `/new?list=`; the Catalog passes `?list=` through to its Request buttons), `POST /lists/:id/items` (Add existing requests), or a request page's Lists card. The list page's fuzzy find (`apps/orders/src/plugins/lists/search.ts`) reuses the catalog's MiniSearch tokenizer, so sizes, typos, SKUs, people and statuses all match.
- Pack quantity (`workers/orders/src/lib/pack-quantity.ts`, migration `0016_pack_quantity.sql`): how many parts one unit of a product is (4 for a pack of 4). Orders counts, prices and budgets what's bought (1 pack); it only matters when parts go to Inventory, which counts parts. `catalog_items.pack_quantity` is what the product is, and each request copies it into `order_requests.pack_quantity` (`packQuantity` on `POST`/`PATCH /requests` and on catalog items; default 1). New Request's "Pack of" field starts from the catalog's, or from a guess read off the product's name (`guessPackQuantity`: "PK4", "10 pack", "box of 50"; `/suggest` returns `packQuantity` and `packQuantityGuess`), shown with the amber "check it's right" hint. A catalog part that's still 1 learns it from a request that says more; after that only catalog editors change it.
- Receiving and Inventory (`workers/orders/src/lib/inventory.ts`): marking parts received can say where they go in the Inventory app (`inventory: { status, locationId?, locations?, robotId?, subsystemId?, quantities? }` on `POST /orders/receive` and `POST /requests/:id/receive`; `locations` is request id → location, `locationId` the place for the rest, and every request needs one or the other). Where each went is kept on the request (`order_requests.inventory_location_id`, migration `0017_inventory_location.sql`). `POST /inventory/defaults { ids }` gives the place each request starts with in the pop-up: with the entry Inventory already has for the part (`from: "entry"`), else where the same catalog part went the last time it was received (`"history"`), else none. Each request goes in as quantity × pack quantity parts, at the unit price over the pack quantity, unless `quantities` says how many arrived. Orders sends them to Inventory's `/intake` over the optional `INVENTORY` service binding, with the person's own session, **before** marking them received, so a failure leaves them on order. `GET /inventory` gives the pages Inventory's places and whether a destination is required: the `inventory_required` row in `app_settings`, off by default, a mentor's toggle on Settings (`PUT /settings` takes `namingTemplate` and/or `inventoryRequired`). Off and with nothing said, nothing reaches Inventory. The pop-up is `apps/orders/src/shared/receive-dialog.tsx`; it isn't shown when Inventory has no locations and nothing is required. Deploy Inventory's worker before Orders'.
- Lookup errors: the agent answers 422 when a vendor's site blocks or fails (the edge worker passes 400/404/422 on and turns anything else into 502); orders shows "This site isn't supported for automatic lookup".

### G3 Skill Tree (skills each student has learned)

- Skills are grouped into trees (Safety, Manufacturing, ...) and categories. A skill opens when the skills it comes after (same category) are complete, a category when the categories before it (same tree) are, and a tree can wait on another tree (`requires_tree_id`; every tree in the default set waits on Safety). An empty category or tree counts as complete. That logic is in the page (`apps/skill-tree/src/shared/progress.ts`); the worker stores what mentors set and doesn't enforce locks, so bulk sign-off can skip them.
- **The trees are a team's content, not part of the app.** A team's trees are one *tree set* (a `tree_sets` row; `workers/skill-tree/src/lib/tree-set.ts`), saved to and loaded from a JSON file (`"format": "gearbox-skill-trees"`, `"version": 1`: trees → categories → skills, each named by a `key`, with `requires` lists of keys; described in `apps/skill-tree/README.md`). The set every team starts with is `workers/skill-tree/content/default-trees.json`. It is loaded the first time anyone opens the app (`currentTreeSet`, the stand-in for the seed hook of roadmap step 4.3) through the same code as any team's file. **No migration holds trees and no code names one**: the app must work the same on any set.
- Loading a file (`applyTreeSet`, one D1 batch, all or nothing) makes the trees match it **by key**: what's still in the file is updated in place (a skill keeps everyone's progress even if the file moves it to another category), what's new is added, and the rest is deleted with the progress on it. `parseTreeSet` checks a file and reports problems in words a mentor can act on; `POST /trees/import/preview` says what a load would add, remove and delete before anything changes. Keys are unique in the set (trees, skills) or in the tree (categories); things made in the editor get a key from their name (`keyFrom`).
- **Students are G3ID's active accounts that aren't mentors** (`lib/roster.ts`, from G3ID's `GET /users/attendance-eligible`). Skill Tree keeps no list of people, only `skill_progress` by G3ID user id, so everyone shows up without opening the app and nobody is added by hand. G3ID's list doesn't say who is a mentor, so the `mentors` table holds what sign-ins have told Skill Tree: a mentor's own (`GET /me`), and everyone's roles whenever a G3ID admin signs in (read from G3ID's `/admin/users` with the admin's session). A PIN session tells it nothing. Until then a mentor who hasn't opened Skill Tree is listed as a student. When G3ID's account list carries roles, `loadStudents` is the one place to change and `mentors` can go. Admins who aren't mentors are students.
- **Anyone signed in** (kiosk PIN sessions too) reads the trees and everyone's progress. **Only G3ID mentors and site admins** (`requireMentor`, never kiosk sessions) sign skills off, edit trees and save or load tree sets. There is no app-level mentor list.
- `workers/skill-tree` (Hono, Drizzle, D1 `SKILL_DB`): `/trees` (the set's name and all its trees with categories, skills and what each requires; mentors `POST`, `PATCH /:id`, `DELETE /:id`, `PUT /order`, `POST /:id/categories`, `GET /export`, `GET /default`, `POST /import/preview`, `POST /import`), `/categories/:id` (`PATCH`, `DELETE`, `POST /:id/skills`), `/skills/:id` (`PATCH`, `DELETE`), `/students` (every student and each started skill's status), `/students/:userId` (one student's progress with who signed each skill off), `PUT /students/:userId/skills/:skillId`, `GET /students/by-pin/:pin` (mentors; asks G3ID whose kiosk PIN it is), `POST /progress` (one status for up to 100 students × 100 skills, 2,000 marks at most). Sign-offs are refused for anyone who isn't a student. Prerequisites must stay inside the category (skills) or tree (categories) and can't loop: a loop is refused with a 400. Every query is kept to the team's tree set.
- Tables (all one team's data, rooted at `tree_sets` so that it's the only one that needs to know the team): `tree_sets` (name, who last loaded it), `trees`, `tree_categories`, `category_prereqs`, `skills`, `skill_prereqs`, `skill_progress` (G3ID user id × skill, status `in-progress`/`complete`, who set it and when; no row = not started), `mentors`. Deleting a tree, category or skill deletes the progress on it. Migration `0003` drops the old tables: everyone's earlier progress was cleared on purpose.
- `apps/skill-tree`: plugin-based UI (from `apps/orders`): Overview, Skill Trees (`/trees/:treeId?student=&category=&skill=`; `plugins/trees/layout.ts` places the boxes and routes the lines), Sign Off and Edit Trees (mentors; its Tree set card saves the set to a file and loads one, showing the preview first). Trees and progress are loaded once and shared (`shared/skill-data.tsx`); progress refreshes on focus and every minute. Each D1 statement stays under 100 bound parameters (`chunks` in `src/lib/input.ts`).

### G3 Inventory (what the team owns and where it is)

- An **entry** (`items`) is one kind of part: a name, the team's own **fields** (`field_values` JSON by field id) and its **vendor listings** (`item_listings`: one vendor's SKU each; equivalent parts from different vendors are several listings on one entry). Stock is counted per place (`stock`): a **location** in storage, or a location plus the **robot** and **subsystem** it's in use on. One row per entry per place; quantity can't go below zero (a CHECK, which fails the whole batch).
- **The arrangement is a team's content, not part of the app.** Fields (`fields`: text, paragraph, number, choice, checkbox, link, date), the tree of locations (`locations`, at most 4 levels: `MAX_DEPTH`), `robots` and `subsystems` are rows a team makes on Settings or loads from a *setup file* (`"format": "gearbox-inventory-setup"`, `workers/inventory/src/lib/setup.ts`; described in `apps/inventory/README.md`). Loading only adds what's missing, matched by name; nothing is changed or removed. A database starts empty; the starter that comes with the app is `workers/inventory/content/starter-setup.json`. **No migration holds any of it and no code names a location, robot or field.**
- **Anyone signed in** (kiosk PIN sessions too) reads everything, adds and edits entries, counts, moves, checks out and in, adds or removes listings, gives a location its title and moves everything in a location. **Mentors and admins** (`requireMentor`) delete, merge and split. **G3ID admins** (`requireAdmin`) use Settings.
- `workers/inventory` (Hono, Drizzle, D1 `INVENTORY_DB`): `/inventory` (everything the table shows), `/options` (locations, robots, subsystems), `/items` (`POST`, `GET|PATCH|DELETE /:id`, `POST /:id/stock`, `POST /:id/listings`, `DELETE /:id/listings/:listingId`, `POST /:id/merge`, `POST /:id/split`), `/stock/:id` (`PATCH` quantity = a count, locationId = move; `POST /:id/check-out`, `POST /:id/check-in`), admin `/fields`, `/locations`, `/robots`, `/subsystems` (each with `PUT /order`), `/setup` (`export`, `starter`, `preview`, `import`), and `/intake`.
- Stock changes are one D1 batch each (`src/lib/stock.ts`): take from the row, add at the new place, log the history line, tidy up. Later statements only act if the row taken from still exists, so two people moving the same parts can't both win. An emptied in-use row is deleted, and so is an emptied storage row when the entry has another storage row; an entry's only storage row stays at zero (so an entry with everything on a robot remembers where it's kept) until stock lands in storage somewhere else. The table shows a row per place with parts, or that zero row when there are none. The Check in pop-up is preset to the entry's first storage row (`storageHome` in `apps/inventory/src/shared/stock-dialogs.tsx`), so parts join it; Check out is preset to stay where the parts are.
- Every change to an entry is a line in `item_events` (its History): created, edited, added, counted, moved, checked_out, checked_in, received, linked, unlinked, merged, split. `ref` links a line to an Orders request (`orders:request:<id>`) or another entry (`item:<id>`).
- **Merge** moves the other entry's stock (adding quantities in the same place), listings and history into this one and deletes it. **Split** makes one listing its own entry, with the quantities the mentor says are its.
- **Orders' catalog:** a listing can carry `catalog_item_id` (a part is on one entry at most). Inventory's prices are per part: a catalog part that's a pack of 4 for $17.50 shows as $4.38 each (`partPriceCents`). The page reads the catalog through `apiPath("orders")` (`apps/inventory/src/shared/catalog.ts`) to show the product page, what was last paid and a Request button; a typed-in listing with the same vendor and SKU, or link, is shown the same way. The worker has no binding to Orders, and a listing keeps its own copy of vendor, SKU, link and price, so Inventory works without it.
- **Location titles and the Locations page:** a location has a `title` (migration `0002_location_titles.sql`): a few words on what's kept there. Wherever a location is named it reads "name - title" (`labelOf` in `workers/inventory/src/lib/locations.ts` and `apps/inventory/src/shared/places.ts`; Orders' receive pop-up does the same), so history lines say "Dungeon › A1 - Misc. Electronics". The Locations page (`/locations`, `apps/inventory/src/plugins/locations/`) is the table turned round: nested panels that open, each location with what's kept directly in it, a title box in its bar, a Move button per entry (the whole row) and "Move all" for everything in the location. `routes/location-contents.ts`: `PUT /locations/:id/title` and `POST /locations/:id/move-contents` (`moveLocationContents` in `lib/stock.ts`: one batch; rows merge with the entry's row already at the new place; the tree itself never changes). Both are for anyone signed in, unlike the tree's own editing on Settings.
- **Received orders:** Orders posts `/intake` (wire types: `@g3/worker-inventory/intake-types`) with the receiving person's session. A delivery finds its entry by listing (catalog id, else vendor + SKU, else link) or becomes a new entry, and is added once per `sourceKey` (`intake_receipts`). Each delivery can name its own `locationId`; every place is checked before anything is added. `POST /intake/places` answers where parts that are about to arrive are already kept (the entry's storage row), changing nothing.
- `apps/inventory`: plugin-based UI (from `apps/skill-tree`): Inventory (`/inventory`: the table; type a quantity to record a count, click a location to move, Check out / Check in pop-ups in `shared/stock-dialogs.tsx`), Add an entry (`/new`), Locations (`/locations`, above), an entry's page (`/items/:id`: details, where it is, vendor listings, history, merge and delete for mentors), Settings (admins). Everything is loaded once and shared (`shared/inventory-data.tsx`), refreshed on focus and every minute.

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
  List each changed app once, by its worker package (`@g3/worker-<app>`, including `@g3/worker-portal`; the edge agent is `@g3/edge-agent`), with the bump from `.changeset/README.md`: **patch** for fixes and small tweaks, **minor** for new features that break nothing, **major** when users or deployers must act (a migration to run first, a removed page, a changed API). For changes that release nothing (docs, CI, tooling only), use an empty header (`---` then `---`). Say which bump you chose and why when you report the commit, so a person can check it; `pnpm release:preview` shows the resulting versions.
- **Releasing**: `.github/workflows/release-pr.yml` keeps one `main` → `public` PR open, titled with the next release (`pnpm release:preview`, which runs the release in a throwaway worktree). Merging it (merge commit only) runs `.github/workflows/release.yml` on `public`: applies the changesets (`pnpm release:version`: versions, CHANGELOG.md files, platform CalVer, RELEASES.md), commits "Release <platform>", tags `v<platform>` and each app's version (`pnpm release:tag`), and merges `public` back into `main`. It pushes with the `RELEASE_DEPLOY_KEY` deploy key, which is on both rulesets' bypass lists.

### Hosting: one worker per app, one gateway

- Each app is one worker: in production it serves the built app (`[env.production.assets]` → `apps/<app>/dist`, single-page-app fallback) and its Hono API at `/api` on the app's own address. Only `/api/*` runs worker code (`run_worker_first`); each worker's default export is wrapped in `withApiPrefix()` (`@g3/site-config/worker`), which drops `/api` so routes stay written as `/requests`, like in dev where Vite's proxy drops it. Apps call `"/api"` (same origin) in production and dev; a page calls another app's API at `apiPath("<app>")` (`/api/~<app>` on its own address: the gateway sends it to that app for the same team, and in dev the `siteConfig()` Vite plugin proxies it to the app's local worker). `apiUrl("<app>")` (`https://<app>.<domain>/api`) is only for addresses outside services call, like webhooks.
- **Workers call each other at `/api` too** (`http://g3id/api/auth/me`, `http://edge/api/lookup`): in production, anything outside `/api/*` would get the app's page.
- `workers/gateway` owns the platform's domain (`<platform>/*`, `*.<platform>/*`) and forwards each hostname to its app's worker through a service binding. It also still owns `*.<domain>/*`, G3's own domain, only to answer G3's retired addresses (`<app>.<domain>`, `api.<app>.<domain>`, `id.<domain>`, `admin.<domain>`) with `410 Gone` and the new address (`RETIRED_HOSTS`), and passes other hostnames (`www`, the edge tunnel) through. Portal has a tiny worker (`workers/portal`) just to serve its page.
- **Teams in the gateway** (`workers/gateway/src/index.ts`): every team, G3 included, is at `<number>-<app>.<platform>` (its home at `<number>.<platform>`); `<number>-<app>.<domain>` is that team's app and `<number>.<domain>` its home (Portal), 404 unless G3ID knows the team (`GET /teams/:id`). For `/api` requests it drops a session that belongs to another team's member (the app sees a signed-out request), refuses an Origin from another team's host, and sets `X-Team-Id`, `X-User-Id`, `X-Session-Type`, `X-User-Roles` after removing any a client sent. Apps don't use those headers yet (Phase 3); production app workers have `workers_dev = false`, so the gateway is the only way in.
- **Sign-in per team** (G3ID stays the sign-in app): each team signs in on its own G3ID, `<number>-id.<platform>` (G3: `1648-id.frcgearbox.com`). G3ID reads the team from the gateway's `X-Team-Id` (`requestTeamId()`, `workers/g3id/src/lib/team.ts`; the site's team without it) and sends members back to `teamFrontend()`. Google, GitHub, Steam and Onshape all call back on the platform host `id.<platform>` (`signInCallbackApiUrl`; the gateway gives it no team), with the team, return address and any account being linked in the sign-in's state (`lib/oauth-state.ts`). Every sign-in method (providers, Slack codes, email, kiosk PIN) only signs in that team's members, and `sanitizeRedirect(url, team)` only allows that team's pages. Cross-team links in Slack DMs use `teamAppUrl(team, "id")`.
- Deploy with `pnpm run deploy` (all) or `pnpm --filter @g3/worker-<app> run deploy` (`wrangler deploy --env production`; `[env.production.build]` in its `wrangler.toml` builds the app first, also in Cloudflare's Git builds). No Cloudflare Pages. See `docs/deploy.md`, including the one-time switch-over.

### Platform (team sign-up)

- `workers/platform` + `apps/platform` on the platform's domain (`site.platformDomain`, frcgearbox.com; the gateway sends the bare domain and `www` there). Its D1 (`PLATFORM_DB`) holds the **team registry**: number, name, country, status (`pending` → `active`), founder. The gateway asks it (`GET /teams/:id`, active teams only) before answering a team's addresses. G3ID keeps accounts, sessions, Slack connections and sign-in codes, plus a copy of each team's id/number/name for its foreign keys.
- Sign-up (`/signup`): team details and the terms → "Add to Slack" (Slack calls back on `<platform>/api/signup/slack/callback`; the platform hands the team and the bot token to G3ID) → a code the founder DMs to the bot. A team with no members makes its first Slack sign-up an active admin (`lib/slack-code.ts`), so the founder is its first admin; the platform then marks the team active and sends them to G3ID's `/auth/slack/complete` on the team's own address, which sets the cookie there. Members join through the team's Slack. No accounts on other providers are needed.
- **False registrations:** the sign-up form warns that a team found to be falsely registered may be permanently deleted with its data. Anyone can report a number at `/report` (`POST /reports`: team number, email, optional name, message), stored in `number_reports` (at most 20 open per number) for an operator to follow up by email; the operators' console lists them.
- The platform reaches G3ID through `/api/internal/*` (teams, Slack installations, sign-up codes; for the console: a team's members, accounts by id, delete, renumber, hand over), over the service binding only: the gateway never answers `/api/internal`.
- **Operators' console** (roadmap 2.8): `workers/platform/src/console.ts` (`/console/*`) + `apps/platform/src/console/`, at `admin.<platform>` (`CONSOLE_HOSTS`, `consoleUrl()`; the gateway sends it to the platform, for no team). Operators are G3ID accounts listed in the platform's `operators` table, never implied by a team role and never on a kiosk session; they sign in through their own team's G3ID, which may send them back to the console on that team's domain (`sanitizeRedirect`). Console changes must come from a console Origin. Tools: list teams and number reports, hand a team to another member (`teams.owner_user_id`; they become admin), renumber it (every G3ID row moves to the new `frc<number>` id), suspend/reactivate, delete it (all its G3ID accounts, sessions, kiosks, Slack). The site's team can't be deleted, renumbered or suspended. Every action, and each look at a team's members, goes in `operator_actions` with the operator's reason; rows older than 12 months are dropped (privacy policy's operator access log). The first operator is added by hand (`docs/deploy.md`).
- **Every team, G3 included, is on the platform's domain** (`<number>-<app>.<platform>`, `<number>.<platform>`). G3 moved there from g3robotics.com, whose app addresses are retired (410). Sign-in providers call back on `id.<platform>` (`signInCallbackApiUrl()`), and the session cookie is set for the domain the request came in on (the platform's, or `gearbox.localhost` in dev). `site.domain` is now only G3's public website and the edge box's tunnel.

### Site config (team, domain)

- The deployment and its own (site) team live in `packages/site-config/src/site.ts` (`@g3/site-config`): the site team's number, name and short name ("G3", which are also its default Team Appearance), the domain, the platform's domain (`platformDomain`), each app's subdomain, public links, the Slack bot's name. **Never hard-code the domain, team number or "G3" branding**: use `appUrl("shop")`, `apiUrl("orders")` (`https://orders.<domain>/api`), `allAppsUrl`, `wordmark("Shop")` ("G3 SHOP"), `appTitle("Shop")` ("G3 Shop"), `idName` ("G3ID"), `teamLinks`, `teamKey` ("frc1648"), `site.team.*`. Internal names (`@g3/*` packages, `g3_session`/`g3_theme` cookies, `--g3-*` CSS, `G3ID` binding, database names) stay as they are.
- CORS for every worker is `cors({ origin: corsOrigin })`: https on the domain and its subdomains, plus localhost. No `*.pages.dev`.
- **Team context per page (roadmap 2.10): one build serves every team.** Nothing team-specific is built into a page. Its team comes from its address (`pageTeamId` / `pageTeamNumber` in `@g3/site-config`: the site team's addresses and plain localhost are the site team, `<number>-<app>.<platform>` or `.gearbox.localhost` is team `<number>`), and its names, colours, logo and links from that team's Team Appearance settings (G3ID's `/team/ui`, loaded by `@g3/ui`). In pages use `useTeamNames()` from `@g3/ui` (`name`, `shortName`, `number`, `wordmark()`, `appTitle()`, `idName`, `links`), not site-config's `wordmark`/`appTitle`/`idName`/`site.team`, which only know the site team (they stay for workers and Slack text). `appUrl()`, `allAppsUrl` and the other address helpers use the page's team. `index.html` has no placeholders: titles are the app's own name and `@g3/ui` puts the team's short name in front. `siteConfig()` in each `vite.config` sets `productionEnv` (`VITE_API_BASE_URL: "/api"`), the version defines and the dev gateway (`localGateway`). No `.env.production` files.
- Files that can't import it (`wrangler.toml` production URLs, the gateway's route, OAuth redirect URIs, `TEAM_NUMBER`; the edge env examples) are written by `pnpm configure` (`scripts/configure.ts`); CI runs `pnpm configure --check`.

### Editable team appearance

- Identity admins edit appearance at the Team Appearance admin page. A team that hasn't saved any gets `teamUiDefaults(team, name)`: the site team's from site.ts, any other team its registered name, its number as the short name ("254 SHOP") and its FRC links; the editor's Reset uses the same (`GET /admin/team/ui` returns `defaults`). `TeamUiSettings` and defaults live in `packages/site-config/src/team-ui.ts`; the team-keyed D1 record is read by public `/team/ui` and edited through admin-only `/admin/team/ui`.
- Shared UI loads colors, logo, display font and team names at runtime (`packages/ui/src/team-ui.ts`), and **every app's colours come from them**: nothing in an app is a fixed brand colour or a fixed grey. `applySettings` sets the variables `colors.css` declares (`--g3-<name>` for the showing theme, `--g3-light-<name>` and `--g3-dark-<name>` for both, `--g3-brand`), the primary palette, the neutral ramps and the browser's `theme-color`. How each kind of app picks them up:
  - **Tailwind apps:** `primary-*` for the team's colour, `bg-surface` for cards (not `bg-white`), `bg-page`, `bg-inset`, `border-line`, and the `secondary-*` (or `gray-*`) ramp for greys. In light mode the ramps are built in and stay exactly so on the default colours; a team that changes its light card, inset, border, text or muted colour gets ramps built from them (`applyNeutrals`: 100 inset, 200 border, 500 muted, 900 text, mixes between). In dark mode `theme-palette.css` builds the ramps from the dark colours the same way.
  - **The top bar** (`nav-bar.css`): surface, border, muted text for links, text for the current page.
  - **Shop:** its own names (`crimson`, `ink`, `paper`, `steel`, `mist` in `apps/shop/src/styles.css`) are the team's brand, text, card, muted and page colours.
  - **Scouting** (plain CSS, `apps/scouting/src/styles.css`): every brand colour and grey is an expression over the `--g3-light-*` / `--g3-dark-*` variables that gives the old colour on the defaults (a rule under `html[data-theme="dark"]` uses the dark ones, any other rule the light ones). Write new rules the same way.
  - **Attendance's kiosk** is always dark and uses `--g3-dark-*`.
  - **What stays fixed:** colours that mean something (green for done or signing in, red for an error, deleting or signing out, amber for a warning, status badges, the red and blue alliances, chart ramps, other companies' logos). The platform's public pages belong to no team and keep the built-in colours.
- **A team's colour is its accent, one per theme** (`light.accent`, `dark.accent`); there is no separate primary colour. The light accent is the brand colour (`brandColor(settings)` in `@g3/site-config`): the primary palette (`--color-primary-50…900`, built in `packages/ui/src/team-ui.ts`) and the app icons take it in both themes, so solid buttons keep their white text. In dark mode the palette's tints (50–300) are dark and brand text (`text-primary-*`, `packages/ui/src/theme.css`) takes the dark accent. A team that keeps the default light accent gets `builtInBrandColor` (`#a32035`): the hand-tuned palette in `index.css` and the icons as drawn.
- The editor's Colors section has the two accent boxes, each with saturation and brightness sliders (HSV; helpers in `packages/site-config/src/color.ts`) and a strip showing the accent on that theme's backgrounds. With **Link the light and dark accents** on (`linkAccents`, the default; only the editor reads it), a colour entered in either box gives the other its hue, and the other keeps its own saturation and brightness (a grey or black has no hue to give); off, both are free. The sliders only ever change their own box, never its hue. The other palette colours are under "More options", closed by default (a field in it that can't be saved opens it), where each theme has a preview (`ThemePreview`): a small mock page using all seven of its colours, with the button in the brand colour.
- Records saved with the old `primaryColor` are read as current ones (`withoutPrimaryColor` in `workers/g3id/src/lib/team-ui.ts`): a brand colour the team chose becomes its light accent, and a dark accent it never chose takes that hue. Public `/team/ui` still sends `primaryColor` (the brand colour) for pages loaded before the change, which build their colours from it; `PUT` refuses it.
- App icons follow the team's brand colour (`packages/ui/src/team-icon.ts`). Each icon file is a black tile with a white drawing and one accent in the built-in brand colour (`#a32035`); for a team with another brand colour, the SVG is read in the browser and that accent swapped. `useTeamIcon(src)` / `<TeamIcon>` from `@g3/ui` do it for an icon on a page (the top bar's, the portal's tiles), and `applyTabIcons` (run with the rest of the appearance) for the page's own `<link>` icons: the tab's SVG, and its `.ico` fallback and home-screen icon redrawn as PNGs. The files don't change, a team with the default colour gets them as they are, and the platform's own public page keeps the default. **A new app icon must use exactly that accent hex** to be recoloured.
- Portal resource links (public site, Slack, GitHub, Instagram, FRC-Events, The Blue Alliance, Statbotics and match13) have editable HTTPS URLs and `hiddenLinks` controls. Hiding preserves the URL; removing clears it. Empty or hidden links are omitted, including the public-site link on the portal sign-in screen.
- Reset to defaults restores the editor form; Save applies it. Stored settings from older versions gain new link and setting defaults without resetting their branding or restoring explicitly empty links. Current writes require the full schema.

### Shared navbar and light/dark mode

- Every app's top bar is `AppNavBar` from `@g3/ui` (`packages/ui/src/components/app-nav-bar.tsx`, styled by its own plain CSS in `nav-bar.css` so it renders the same in G3 Strategy, which doesn't use the shared Tailwind theme). Each app's `shared/nav-bar.tsx` is a thin wrapper: it filters pages by permission, marks the current one (`activePath`: the most specific link covering the URL), and passes react-router links via `linkWith(Link)`. Pages go in a drawer below 768px.
- Light/dark is one setting for all apps: the `g3_theme` cookie on `.g3robotics.com` (shared across ports on localhost), applied as `html[data-theme]` before first paint by a small script in each app's `index.html`; `useTheme`/`setTheme` (`packages/ui/src/theme.ts`) change it, and open tabs pick up a change on focus. No cookie → the system setting.
- One color scheme for every app (`packages/ui/src/colors.css`): page `#f4f6f7` / dark `#171717`, surface (cards, top bar) `#ffffff` / `#262626`, inset `#eef1f3` / `#1e1e1e`, line, text, muted and accent, as `--g3-*` CSS variables that switch with the theme. Those are the defaults; a team's own colours (Team Appearance) replace them at runtime. Tailwind apps use them as `bg-page`, `bg-surface`, `bg-inset`, `border-line`; every page's root background is `bg-page` and every card's `bg-surface`. `--g3-brand` is the team's colour for solid fills (the light accent in both themes); `--g3-light-*` and `--g3-dark-*` are both themes' colours whichever is showing, for a rule written for one theme.
- Apps are styled light. Dark mode comes from `packages/ui/src/theme.css` + `theme-palette.css`: neutral ramps (secondary, gray, slate, ...) invert onto the dark palette's colours, tinted backgrounds (`*-50..300`) become dark tints, and dark text shades (`text-*-600..950`) become light. Solid fills (`bg-*-500/600`) are unchanged. So write light-mode classes; use a hex value (`bg-[#24292f]`) only for a color that must not change in dark mode, and never for the team's colour or a grey.

### Color Implementation

The built-in colors are in `packages/ui/src/index.css`'s `@theme` block and `colors.css`; a team's own replace them at runtime (see "Editable team appearance"):
- Primary palette (the team's colour; burgundy by default): primary-50 through primary-900
- Secondary palette (neutral grays, from the team's text, muted, border and inset colours): secondary-50 through secondary-900
- Used across all apps via Tailwind classes
- **Do not use hardcoded colors**, and don't use a Tailwind colour like `red` or `blue` as an accent: use `primary-*`, `secondary-*`, `bg-surface`, `bg-page`, `bg-inset` and `border-line`. Red, green, amber and the like are for meaning only (an error, deleting, done, a warning)

### Database Schema

Key tables in D1:
- `teams` — each team, keyed by `frc<number>` (`teamKey`). G3ID doesn't read the gateway's `X-Team-Id` yet (sign-in per team is roadmap 2.5), so the rows it creates are for the team in site.ts (`currentTeamId()` in `workers/g3id/src/lib/team.ts`)
- `core_users` — user accounts with status (pending/active/rejected); **each belongs to exactly one team** (`team_id`, no memberships table; roles stay as `is_admin`/`is_mentor`)
- `core_user_identities` — linked auth providers per user
- `core_sessions` — active sessions (deprecated in favor of KV)
- `core_user_pins` — 3-digit PINs for kiosk login, unique within a team; a kiosk signs in only its own team's members
- `kiosk_devices` — registered shop devices with tokens, in the activating admin's team
- `kiosk_activation_codes` — 6-digit codes for device activation (30-min expiry)
- `core_slack_link_codes` — Slack sign-in and link codes with polling status: 4 digits, unique within a team (migration 0015); `insertCode` in `lib/slack-code.ts` deletes codes a day after they expire and draws again if a code is taken

Migrations are SQL files in `workers/g3id/src/db/migrations/` — always add new migrations for schema changes.

### Slack Integration

Three flows:
1. **Sign-in**: User runs `/signin 123456` with a code from the web app
2. **Link**: Authenticated user runs `/link 123456` to add Slack to their account
3. **Events**: Slack bot receives 4-digit codes via DM and processes them

Routes:
- `POST /slack/events` — Slack event API (URL verification, DM messages)
- `POST /slack/commands/signin` — `/signin` slash command
- `POST /slack/commands/link` — `/link` slash command
- `GET /auth/slack/initiate` — Start sign-in flow
- `GET /auth/slack/link` — Start linking flow
- `GET /auth/slack/status` — Poll for completion (frontend calls every 2s)

Rate limiting: 5 attempts per 15 minutes per Slack user (via KV).

**Slack per team:** one Slack app, installed into each team's workspace by a team admin (G3ID Admin → Slack: `GET /slack/install`, Slack calls back on `id.<platform>/api/slack/oauth/callback`). `slack_installations` holds each team's workspace ID and bot token, encrypted with the `SECRETS_KEY` secret (`lib/secret-box.ts`). `lib/slack-install.ts`: `slackForTeam(env, team)` gives the workspace and a `{ SLACK_BOT_TOKEN }` for `@g3/slack`; `teamForWorkspace(env, workspaceId)` routes slash commands and events. A sign-in code only works from its own team's workspace. The site's team falls back to the `SLACK_BOT_TOKEN` / `SLACK_TEAM_ID` settings until it connects. Other workers' Slack messages (Orders, Shop, Scouting) still use their own `SLACK_BOT_TOKEN` (G3's) until Phase 3.

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
- Attendance's records are in its own D1 database (`ATTENDANCE_DB`); `workers/attendance/test/attendance-d1.test.ts` covers sign-in/out, hours, auto-closed sessions and admin actions against it.

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
- `apps/platform` → 5185
- `apps/inventory` → 5186

Workers (Wrangler):
- `workers/g3id` → 8787 (inspector: 9229)
- `workers/shop` → 8788 (inspector: 9230)
- `workers/pit` → 8789 (inspector: 9231)
- `workers/skill-tree` → 8790 (inspector: 9232)
- `workers/attendance` → 8791 (inspector: 9233)
- `workers/scouting` → 8792 (inspector: 9234)
- `workers/edge` → 8793 (inspector: 9235)
- `workers/orders` → 8794 (inspector: 9236)
- `workers/platform` → 8795 (inspector: 9237)
- `workers/inventory` → 8797 (inspector: 9239)
- `workers/gateway` → 8796 (inspector: 9238): every team's addresses on `*.gearbox.localhost:8796` (below)
- `devices/edge-agent` (mock) → 8700

**Starting dev servers:**
- `pnpm dev` — Start all servers and print port summary after ready
- `pnpm dev:silent` — Start all servers without port printer

**Team addresses in dev (the gateway, roadmap 2.9):** `pnpm dev` also runs the gateway on 8796, with `gearbox.localhost` (`DEV_DOMAIN`) standing for the platform's domain: `http://gearbox.localhost:8796` is the platform (sign-up), `http://1648-id.gearbox.localhost:8796` the site team's G3ID, `http://<number>-<app>.gearbox.localhost:8796` any team's app, `http://<number>.gearbox.localhost:8796` its home, `http://admin.gearbox.localhost:8796` the console. It's a name under `localhost` because browsers send those to your machine, but not `localhost` itself: browsers won't share a `Domain=localhost` cookie across subdomains, and they do share `Domain=gearbox.localhost`, so one sign-in covers every app. `/api` goes to the app's local worker (with `X-Team-Id`, like production) and pages to its Vite server. Every link in dev stays local: pages get the gateway from the `siteConfig()` Vite plugin (`localGateway` in `@g3/site-config`), so `appUrl`, `teamAppUrl`, `allAppsUrl`, `platformUrl` and `consoleUrl` give dev-gateway addresses (production builds never do); G3ID and the platform get it as `LOCAL_GATEWAY_URL` (`teamAppUrlVia`, `platformUrlVia`, G3ID's `teamFrontend`/`teamUrl`). A team other than the site's only answers once it's signed up in the local platform database. The apps' own ports keep working as before. The gateway listens on 127.0.0.1: for curl, add `--resolve <host>:8796:127.0.0.1`.

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

See `docs/deploy.md`. In short: `pnpm run deploy` builds each app and deploys its worker (`--env production`), then the gateway. Edge-agent upgrades are in `infra/edge/README.md`, including PowerShell steps for deploying from Windows. Apply D1 migrations first (`pnpm db:migrate:remote`). No Cloudflare Pages.

## Key Files to Know

- `docs/roadmap/roadmap.md` — The multi-team platform roadmap: phases, each step's status, confirmed hosting decisions, open questions
- `docs/legal/` — Draft Terms of Service and Privacy Policy for the hosted platform (not in force)
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
