# Deploying

Every app is one Cloudflare Worker that serves the app's page and its API at `/api` on each team's address for it (`https://1648-orders.frcgearbox.com` and `https://1648-orders.frcgearbox.com/api`). One more worker, the **gateway** (`workers/gateway`), owns frcgearbox.com and its subdomains and sends each request to the right app's worker, for the right team, by hostname. Cloudflare Pages isn't used.

```
browser ──> 1648-orders.frcgearbox.com ──> gateway ──(service binding)──> orders worker ──> /api/*  → Hono routes
                                                                        └─> anything else → the built app (apps/orders/dist)
```

- G3's **old addresses** on g3robotics.com (`orders.g3robotics.com`, `api.orders.g3robotics.com`, `id.` and `admin.g3robotics.com`) are retired: the gateway answers them `410 Gone` with the address to use instead. Other g3robotics.com hostnames (`www`, the edge box's tunnel) pass through untouched.
- Every team, G3 included, has its own addresses on the platform's domain: `<number>-<app>.frcgearbox.com` and `<number>.frcgearbox.com` (the team's home). The gateway keeps each team's sessions and API calls to its own hosts and tells the app the team and user in `X-Team-Id` / `X-User-*` headers. App workers have no workers.dev address in production (`workers_dev = false`), so those headers can only come from the gateway.
- An app worker's own code only runs for `/api/*` (`run_worker_first` in its `wrangler.toml`); everything else is static files, with unknown paths falling back to `index.html` for the app's router. Workers call each other through service bindings at `/api` too (`http://g3id/api/auth/me`). A page calls another app's API at `/api/~<app>/…` on its own address (`apiPath` in `@g3/site-config`), which the gateway sends to that app for the same team.

## Deploying a change

```bash
pnpm run deploy                               # every app worker, then the gateway
pnpm --filter @g3/worker-orders run deploy    # one app: builds apps/orders, then deploys it
```

Each app worker uploads `apps/<app>/dist` with it, so its `wrangler.toml` has a production build command (`[env.production.build]`) that builds the app first, whoever runs `wrangler deploy --env production` or `wrangler versions upload --env production`. Deploy with `--env production` only (the scripts do). If your Cloudflare login can see several accounts, set `CLOUDFLARE_ACCOUNT_ID` first.

Apply D1 migrations before deploying a worker that needs them (`pnpm db:migrate:remote`).

A worker with a service binding to another worker can't be deployed until that worker exists. `pnpm run deploy` goes in the right order. Orders binds Inventory (received parts are added to it), so the first time, Inventory goes first: create its database (`wrangler d1 create g3-inventory-prod`), paste the id into `workers/inventory/wrangler.toml`, apply its migration (`pnpm --filter @g3/worker-inventory run db:migrate:remote`) and deploy it (`pnpm --filter @g3/worker-inventory run deploy`), before Orders and the gateway. 

**Production deploys itself:** merging the release PR into `public` runs `.github/workflows/release.yml`, which commits the release and then deploys it through `.github/workflows/deploy.yml`: the D1 migrations (`pnpm db:migrate:remote`), every app's worker (`pnpm run deploy`, each building its page first) and the gateway last. Staging deploys from `main` through the same workflow. It needs a GitHub environment named `production` with the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (one token can serve both environments). Anything that must happen before a deploy other than migrations (a setting, an outside service moved, a secret) must still happen before merging the release PR. Cloudflare's Git integration (Workers Builds) is no longer used: each production Worker's build must be disconnected (the Worker → Settings → Builds → Disconnect), or it would deploy too, without migrations first.

**For now, production can deploy from `main`:** with the repository variable `PRODUCTION_BRANCH` set to `main` (GitHub → Settings → Secrets and variables → Actions → Variables), every push to `main` deploys staging and then, if that went through, production, migrations included; the release workflow then doesn't deploy. Every merged pull request then goes live a few minutes after it reaches staging, so staging only stops production when its own deploy fails; it no longer gives time to try a change first. Delete the variable (or set it to `public`) to go back to deploying production only at releases.

## Staging

Staging is a second copy of everything, deployed from `main` (or the branch in `STAGING_BRANCH`, below) on every push by `.github/workflows/staging.yml` through the same `deploy.yml` as production (migrations, then each app's worker, then the gateway). Its addresses are production's with `-dev` on the first part, on g3robotics.com: `1648-orders-dev.g3robotics.com`, a team's home at `1648-dev.g3robotics.com`, sign-in callbacks at `id-dev.g3robotics.com`, the console at `admin-dev.g3robotics.com` and the platform at `dev.g3robotics.com` (`site.staging` in `site.ts`). A different domain from production's, so the two never share a cookie; every page has a "Staging" banner.

Each worker's `[env.staging]` is written by `pnpm configure` from its `[env.production]` (below the "Staging" line at the end of each `wrangler.toml`): `-staging` worker names, databases and buckets, staging's addresses, and the ids in `infra/staging/resources.json`. Change `[env.production]` and run `pnpm configure`; never edit the staging part. Production's gateway answers only G3's retired addresses on g3robotics.com, by exact name, and staging's gateway only `*-dev.g3robotics.com` and `dev.g3robotics.com`.

To deploy staging by hand: `pnpm db:migrate:staging`, then `pnpm deploy:staging` (or one worker's `deploy:staging`).

### Trying a branch on staging

Staging deploys from `main` unless the repository variable `STAGING_BRANCH` names another branch (GitHub → Settings → Secrets and variables → Actions → Variables). Set it to a feature branch and every push to that branch deploys staging, migrations included, while pushes to `main` don't. Delete the variable (or set it to `main`) to go back. To deploy a branch once without changing the variable, run the workflow by hand on it (Actions → staging → Run workflow, then pick the branch).

- **Migrations stay applied.** A branch's migrations are applied to staging's databases and aren't undone when staging goes back to `main`. If the branch's schema changes don't land as they are, staging's databases have to be put right by hand.
- **One branch at a time.** Whatever deployed last is what staging runs, so say when you take it over.
- **With `PRODUCTION_BRANCH` set to `main`,** a push to `main` while staging is on another branch still deploys production, without staging first.

### Setting staging up (once)

1. **Resources:** `pnpm staging:create` (with a Wrangler login; `-- --dry-run` first to see what it would make). It makes each staging D1 database, the KV namespaces (Sessions and Rate limit), Shop's and Scouting's R2 buckets and Shop's queue, writes their ids into `infra/staging/resources.json` and the `wrangler.toml` files, and deploys an empty placeholder for each staging Worker so the first deploy can bind them to each other. Commit the changed files.
2. **DNS** on g3robotics.com: a proxied wildcard record `*` → AAAA `100::`, if there isn't one already (it covers `dev` and every `-dev` name). Hostnames with their own records (`www`) keep them.
3. **GitHub:** an environment named `staging` (Settings → Environments) with the secrets `CLOUDFLARE_API_TOKEN` (a token with the "Edit Cloudflare Workers" template plus D1 edit) and `CLOUDFLARE_ACCOUNT_ID`, and the same two in one named `production`.
4. **Secrets** on the staging Workers (`wrangler secret put <NAME> --env staging` in each worker's folder):
   - `SECRETS_KEY` on `g3id`, `orders` and `shop`: a new value for each (`openssl rand -base64 32`), never production's.
   - `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET` and `STEAM_API_KEY` on `g3id` (production's values: the same sign-in apps).
   - `TBA_AUTH_KEY` and `NEXUS_API_KEY` on `pit` and `scouting`.
5. **Sign-in providers:** add `https://id-dev.g3robotics.com/api/auth/google/callback` to the Google client and `https://id-dev.g3robotics.com/api/auth/github/callback` to the GitHub app.
6. **Deploy:** run the workflow (Actions → staging → Run workflow), or push to `main`.
7. **The first operator:** as in "The operators' console" below, with `--env staging`.

### Copying G3's data to staging

`pnpm staging:copy-team` copies the site team's data (G3's) from production's databases into staging's, replacing what staging has for it, so a release and its migrations can be tried on real data first. Production is only read. Run `pnpm staging:copy-team -- --dry-run` first: it shows how many rows each table would bring and writes the SQL it would run. `--only g3id,orders` limits it to some databases.

- **What's copied:** every table's rows for G3, the tables that belong to it through another (sign-ins through accounts, the skill trees through the tree set), Orders' starter catalog, and all of Scouting (only G3 has it).
- **What isn't:** sessions, sign-in and kiosk codes, kiosks and PINs, the Slack and Discord installations, settings encrypted with production's `SECRETS_KEY` (Onshape's keys, Share-A-Cart), sign-in providers' tokens, the edge box's key, each student's browsing (Edge's site usage), caches, the platform's operator records, KV (everyone signs in again on staging) and R2 files (drawings and field maps show as missing). Staging's own sessions and kiosks for G3 are cleared.
- **First:** staging must be on the same migrations as production; a database that isn't is skipped with a note. Deploy staging (or `pnpm db:migrate:staging`) and run it again.
- **Only G3:** copying another team's data would go against the privacy draft (operators look at a team's data only to fix what it reports, and a removed member is gone within 30 days), so the script doesn't offer it. G3's copy on staging should be refreshed or cleared after a member is removed in production.

### Slack on staging

Staging has its own Slack app ("Gearbot Staging"), installed in G3's workspace: a Slack app has one events address, so production's can't serve staging too, and in G3's workspace the staging copy of G3's accounts (`pnpm staging:copy-team`) keeps its Slack sign-ins. Its client and app IDs are in `infra/staging/resources.json` (`slack`), which `pnpm configure` writes into staging's config; production's workspace setting (`SLACK_TEAM_ID`) isn't used there, so G3 connects staging's Slack on its Integrations page.

1. **The app's settings** (api.slack.com/apps → the staging app):
   - **OAuth & Permissions:** redirect URLs `https://id-dev.g3robotics.com/api/slack/oauth/callback` and `https://dev.g3robotics.com/api/signup/slack/callback`; bot token scopes `commands`, `chat:write`, `im:write`, `im:history`, `users:read`, `users:read.email`, `channels:read`, `groups:read` (`SLACK_BOT_SCOPES` in `@g3/slack`).
   - **Event Subscriptions:** on, request URL `https://id-dev.g3robotics.com/api/slack/events` (staging must be deployed for Slack to verify it); bot events `message.im`, `app_uninstalled`, `tokens_revoked`.
   - **Slash Commands:** `/signin-staging` → `https://id-dev.g3robotics.com/api/slack/commands/signin`, `/link-staging` → `https://id-dev.g3robotics.com/api/slack/commands/link` (not `/signin` and `/link`, which production's app has in the same workspace).
   - **App Home:** Messages Tab on, and "Allow users to send Slash commands and messages from the messages tab" on, so members can DM it their code.
   - **Manage Distribution:** on, only to try another team's sign-up on staging (it installs the app in that team's workspace).
2. **Secrets** (from the app's Basic Information page), with `export WRANGLER_HIDE_BANNER=true` first:
   ```bash
   cd workers/g3id
   pnpm exec wrangler secret put SLACK_CLIENT_ID --env staging       # the client ID
   pnpm exec wrangler secret put SLACK_CLIENT_SECRET --env staging
   pnpm exec wrangler secret put SLACK_SIGNING_SECRET --env staging
   cd ../platform
   pnpm exec wrangler secret put SLACK_CLIENT_SECRET --env staging
   ```
3. **Connect it:** on staging, sign in as an admin, open the home's Admin → Integrations, and Connect Slack. Members can then sign in with Slack there by DMing their code to Gearbot Staging.

Pages still name the bot "Gearbot" (`slackBotName`); on staging it's Gearbot Staging.

## Discord (once)

A team uses Slack or Discord, one at a time (`docs/roadmap/discord.md`). One Discord app serves every team, with one bot token; a team's connection is only its server's id. Discord is always offered, so the app's settings below are required, like Slack's: without them, Discord's buttons lead to errors.

1. **Make the app** at discord.com/developers/applications, named **Gearbot** (`discordBotName` in `site.ts`).
   - **Bot:** Public Bot on. No privileged intents: Gearbox never reads messages. Reset and copy the token.
   - **OAuth2 → Redirects:** `https://id.frcgearbox.com/api/auth/discord/callback` (signing in, linking, and admins connecting their server) and `https://frcgearbox.com/api/signup/discord/callback` (team sign-up). For local dev, also `http://localhost:5173/api/auth/discord/callback`.
   - The bot asks for View Channels and Send Messages when it's added (`DISCORD_BOT_PERMISSIONS` in `@g3/discord`).
2. **Config:** set `DISCORD_CLIENT_ID` (OAuth2 → Client ID) in `[env.production.vars]` of `workers/g3id/wrangler.toml` and `workers/platform/wrangler.toml`, then run `pnpm configure`. Secrets, with `export WRANGLER_HIDE_BANNER=true` first:
   ```bash
   cd workers/g3id
   pnpm exec wrangler secret put DISCORD_CLIENT_SECRET --env production
   pnpm exec wrangler secret put DISCORD_BOT_TOKEN --env production
   cd ../platform
   pnpm exec wrangler secret put DISCORD_CLIENT_SECRET --env production
   ```
3. **Migrations:** G3ID's `0019_discord.sql` (the `discord_installations` table, and `discord` as a sign-in provider) and the platform's `0011_discord.sql` run before the Workers deploy, as usual.
4. **Staging:** a second app, "Gearbot Staging", with the redirects `https://id-dev.g3robotics.com/api/auth/discord/callback` and `https://dev.g3robotics.com/api/signup/discord/callback`. Put its client ID in `infra/staging/resources.json` as `"discord": { "clientId": "..." }`, run `pnpm configure`, and put the same three secrets with `--env staging`.
5. **Local dev:** set `DISCORD_CLIENT_ID` in `workers/g3id/wrangler.toml`'s `[vars]` (and the platform's, to try sign-up), and `DISCORD_CLIENT_SECRET` and `DISCORD_BOT_TOKEN` in each Worker's `.dev.vars`.

Admins connect their server on the home's Admin → Integrations (Connect Discord: it takes the admin to Discord to pick a server they manage, and links the admin's Discord to their account). A team on Slack disconnects Slack first. Members then sign in with Discord if they're in the server; someone new waits for an admin's approval, as with Slack. A private channel needs Gearbot's role allowed in it before the bot can post there; the channel picker says so.

## Switching over from Pages and per-app API domains (once, done)

The app workers' old `api.<app>` custom domains send requests straight to the worker, without the `/api` the gateway adds, so they must go when the new workers go live. Do this at a quiet time; the apps are down for the few minutes between steps 3 and 5.

1. **Sign-in providers:** sign-in callbacks are now on the new addresses, so add them to each provider before deploying (keep the old ones until the switch is done):
   - Google, GitHub: `https://id.<domain>/api/auth/<provider>/callback` (`google`, `github`). Every team's sign-in calls back there; the team travels in the sign-in's state. Steam needs no change: it accepts any return address.
   - Share-A-Cart: Orders now calls back on `https://orders.<domain>/api/share-a-cart/callback`; reconnect it once on Orders' Settings page after the switch.
2. **DNS:** make sure there's a proxied wildcard record for the domain: `*` → AAAA `100::` (proxied, orange cloud). Hostnames with their own records (`www`) keep them.
3. **Deploy the app workers:** `pnpm --filter "./workers/*" --filter "!@g3/worker-gateway" run deploy`.
4. **Remove the old hostnames:**
   - Workers & Pages → each app worker → Settings → Domains & Routes: remove its `api.<app>.<domain>` custom domain.
   - Each Cloudflare Pages project: remove its custom domain (`orders.<domain>`, ...). Delete the projects once everything works.
5. **Deploy the gateway:** `pnpm --filter @g3/worker-gateway run deploy`.
6. **Check:** sign in with each provider; open each app; `https://<app>.<domain>/api/health` answers with the app's version.

## The platform and frcgearbox.com (once)

The platform Worker serves `frcgearbox.com` (team sign-up) and every other team's addresses (`<number>-<app>.frcgearbox.com`). G3 stays on its own domain.

1. **Zone and DNS:** add `frcgearbox.com` to the Cloudflare account, with proxied records for the domain itself and a wildcard: `@` and `*` → AAAA `100::`.
2. **Database:** `wrangler d1 create gearbox-platform-prod`, paste its ID into `workers/platform/wrangler.toml`, and apply its migrations (`pnpm --filter @g3/worker-platform db:migrate:remote`).
3. **Slack app:** add the redirect URLs `https://frcgearbox.com/api/signup/slack/callback` and `https://id.frcgearbox.com/api/slack/oauth/callback`. Set `SLACK_CLIENT_ID` in `workers/platform/wrangler.toml` and the `SLACK_CLIENT_SECRET` secret on the platform Worker (the same values as G3ID's).
4. **Sign-in providers:** add `https://id.frcgearbox.com/api/auth/<provider>/callback` for Google and GitHub (other teams' sign-ins call back there).
5. **Deploy** G3ID, then the platform Worker, then the gateway (it binds to the platform).

## The operators' console (once)

Platform operators manage teams at `admin.frcgearbox.com`. The gateway sends it to the platform Worker, which serves the console at `/console`.

1. **DNS:** covered by the platform domain's wildcard record.
2. **Database:** apply the platform's migrations (`pnpm --filter @g3/worker-platform db:migrate:remote`) before deploying its Worker.
3. **The first operator:** open the console, sign in, and copy the account id it shows. Then:
   ```bash
   pnpm --filter @g3/worker-platform exec wrangler d1 execute PLATFORM_DB --env production --remote \
     --command "INSERT INTO operators (user_id, created_at) VALUES ('<account id>', unixepoch())"
   ```
   Operators add each other on the console's Operators page after that.

## Moving G3 to frcgearbox.com (once)

G3's apps move from `<app>.g3robotics.com` to `1648-<app>.frcgearbox.com` (its home to `1648.frcgearbox.com`, sign-in to `1648-id.frcgearbox.com`). The old app addresses, and `id.` and `admin.g3robotics.com`, stop working: the gateway answers them `410 Gone` with the new address. `www.g3robotics.com` is unaffected. Everyone signs in again once, since sessions belong to a domain.

Before merging the release PR that includes the move (it deploys on merge):

1. **frcgearbox.com is set up** (above): zone, `@` and `*` DNS records, the platform Worker, migrations, and team 1648 active in the platform's registry (its first migration adds it).
2. **Sign-in providers:** `https://id.frcgearbox.com/api/auth/<provider>/callback` registered with Google and GitHub (Steam needs nothing).
3. **Slack app:** slash commands and events at `https://id.frcgearbox.com/api/slack/...` (`/commands/signin`, `/commands/link`, `/events`), and the redirect URLs `https://id.frcgearbox.com/api/slack/oauth/callback` and `https://frcgearbox.com/api/signup/slack/callback`.
4. **Edge box:** `EDGE_WORKER_URL=https://1648-edge.frcgearbox.com/api` in `/etc/g3-edge/agent.env`, then restart the agent.

Right after the release:

- **Onshape webhook:** save the Onshape settings on Shop's admin page once (`https://1648-shop.frcgearbox.com`), which moves the webhook.
- **Share-A-Cart:** reconnect it on Orders' Settings page (its callback moved with Orders).
- **Tell the team** the new addresses; bookmarks to the old ones show where each app went.

## Retiring the old `api.<app>` addresses (once, done; superseded by the move above)

The gateway stops answering `api.<app>.<domain>` (it says `410 Gone`). Move everything outside the repo that still calls them **before merging the release PR**, since that merge deploys it:

- **Slack app:** change the slash command and event URLs to `https://id.frcgearbox.com/api/slack/...` (`/commands/signin`, `/commands/link`, `/events`). Slack verifies the events URL when you save it.
- **Onshape webhook:** save the Onshape settings on Shop's admin page once; it registers the webhook at `https://shop.<domain>/api/onshape/events`.
- **Edge box:** now `EDGE_WORKER_URL=https://1648-edge.frcgearbox.com/api` (see the move above). An old `api.edge.g3robotics.com` value fails every upload with a certificate error, since that two-level name has no certificate any more.
- **Sign-in providers:** remove the old `api.g3id.<domain>` and `id.<domain>` callback URLs (they're on `id.frcgearbox.com` now).
- **Anything else** (a bookmark, a script, a kiosk) gets a `410` naming its new address, so it's easy to spot in the gateway's logs.

## Shop for every team (once, roadmap Phase 3)

Shop keeps each team's files in R2 under `teams/<team>/`, each team's Onshape keys in its own settings (encrypted), and posts to Slack through G3ID. Before merging the release PR that brings it:

1. **Encryption key:** `wrangler secret put SECRETS_KEY --env production` in `workers/shop` (`openssl rand -base64 32`; keep it, since it decrypts the stored keys).
2. **Copy G3's files** to their team prefix: `pnpm --filter @g3/worker-shop r2:move-to-team -- --dry-run` to see what it would copy, then without `--dry-run`. It only copies (and skips what's already copied), so the running Shop keeps working.
3. **Migration:** `pnpm --filter @g3/worker-shop run db:migrate:remote` (`0016_teams.sql`), right before the merge: it points the stored file keys at the copies, and the Shop that's still running can't save settings until the new one is deployed.

After the release:

- **Onshape** keeps working on the `ONSHAPE_*` worker secrets for G3 until an admin saves G3's keys on Shop's Admin page (API keys and webhook signing keys from Onshape's Developer Portal); after that the secrets can be deleted. Other teams enter their own there; saving registers the team's webhook at `https://<number>-shop.frcgearbox.com/api/onshape/events`.
- **Old copies in R2:** once drawings and part files open, `pnpm --filter @g3/worker-shop r2:move-to-team -- --delete-old` removes the originals (only those whose copy is there).
- **Slack:** Shop's `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` secrets are no longer used; delete them. Release and summary posts go to the channels set on the Admin page, on the team's own Slack.

## Shop's batches (once)

Shop's migration `0019_batches.sql` goes with the Shop that tracks a batch as one unit. The deploy applies it with the rest; by hand it is `pnpm --filter @g3/worker-shop run db:migrate:remote`, right before deploying Shop's worker.

- **What it does to the data:** every batch gets a number (the one it was known by), a status at its File Producer process and one at its File Consumer process, from where its parts were. A file that was assigned straight to instances becomes a batch of them, one for each file, File Producer process and status there. An instance that had a file but hadn't reached its File Producer process, or has none, loses the link; the file stays in the library, under Unused. `part_instance_files` is dropped.
- **Between the migration and the new worker,** the Shop that's still running can't list files or open a File Producer or File Consumer process's page. Do both together, when the shop isn't working.
- **Afterward,** a file made for a part that is now obsolete is under Obsolete on the Files page and can't go on another batch.

## Edge for every team (once, roadmap Phase 3)

Each team's box now signs in with its own key, stored hashed in Edge's database, in place of the shared `EDGE_AGENT_KEY` secret. G3's box keeps the key it has. Before merging the release PR that brings it:

1. **Migration:** `pnpm --filter @g3/worker-edge run db:migrate:remote` (`0005_teams.sql`). It rebuilds the usage tables with the team in their keys; check their size first (`wrangler d1 execute g3-edge-prod --remote --env production --command "SELECT count(*) FROM net_site_usage"`) if it's been a long time.
2. **G3's box key:** `EDGE_AGENT_KEY=<the current key> pnpm --filter @g3/worker-edge box-key:set` stores its hash as G3's box key (the key is in the box's `/etc/g3-edge/agent.env`).

Right after the release:

- **Agent:** upgrade G3's box to the agent in this release (`infra/edge/README.md`); it reports the box's time zone. Before that, G3's days stay New York's (the migration stored it). Check the box's own zone first: `timedatectl` should say the shop's (`sudo timedatectl set-timezone America/New_York`).
- **Secret:** delete the edge worker's `EDGE_AGENT_KEY` secret (`wrangler secret delete EDGE_AGENT_KEY --env production` in `workers/edge`); nothing reads it.
- **Another team's box:** an admin makes its key on the Edge app's Edge Box page and puts it in the box's `agent.env` with `EDGE_WORKER_URL=https://<number>-edge.frcgearbox.com/api`.

## Deleting teams and Share-A-Cart secrets (once, roadmap Phase 3)

- **Orders:** before deploying, set its encryption key: `wrangler secret put SECRETS_KEY --env production` in `workers/orders` (`openssl rand -base64 32`; keep it). G3's Share-A-Cart connection is encrypted the first time it's used; without the key, Share-A-Cart stops working.
- **Platform:** its worker now binds every team-scoped app (to delete a team's data in each), so deploy it after them; `pnpm run deploy` deploys the platform with the other workers, which all exist already.

## Portal's logo (once, roadmap Phase 3)

Portal no longer has G3's logo built in. After the release, a G3ID admin sets G3's logo URL on the team's Appearance page (`https://1648.frcgearbox.com/admin/appearance`) (an https link to the image, e.g. on G3's public site); until then Portal's public-site tile shows a globe.

## The app library (once, roadmap Phase 4)

- **Platform first:** apply its migration `0005_team_apps.sql` (`pnpm --filter @g3/worker-platform run db:migrate:remote`) before the release deploys. It switches every app on for every team already signed up (G3 included), so nothing disappears; teams signing up after it start with none.
- The platform now has a daily cron (cleaning up apps switched off more than 90 days ago); `wrangler deploy` sets it up, nothing to do by hand.
- The gateway asks the platform which apps a team has on. If it's deployed before the platform's new code, it sees no app list and leaves every app open, so the order doesn't break anything.
- Slack's install now returns admins to the team's home (`<number>.frcgearbox.com/admin/slack`), still through G3ID's `id.<platform>` callback: nothing changes in the Slack app's settings.

## Other outside services

- **Slack for other teams:** in the Slack app's settings, set its display name to **Gearbot** (`slackBotName` in `site.ts`), turn on distribution (Manage Distribution), add the redirect URL `https://id.frcgearbox.com/api/slack/oauth/callback`, give the bot the scopes `commands, chat:write, im:write, im:history, users:read, users:read.email, channels:read, groups:read` (the last two let admins choose channels by name; a workspace connected before they were added has to be connected again on the Integrations page, and until then the channel boxes take a channel ID), and subscribe to the `app_uninstalled` and `tokens_revoked` events. Then set G3ID's secrets `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (Basic Information → App Credentials) and `SECRETS_KEY` (`openssl rand -base64 32`; keep it, since it decrypts the stored tokens). Team admins connect their workspace on G3ID's Admin → Slack page; G3 can keep its current settings.

