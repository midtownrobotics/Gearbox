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

**Production deploys itself:** Cloudflare's Git integration (Workers Builds) deploys each Worker when the `public` branch changes, which happens when the release PR is merged. So anything that must happen before a deploy (a migration, a setting, an outside service moved) must happen before that merge. The builds need no extra setup: their `wrangler deploy` / `wrangler versions upload --env production` runs the same build command. Leave their build command empty.

## Switching over from Pages and per-app API domains (once, done)

The app workers' old `api.<app>` custom domains send requests straight to the worker, without the `/api` the gateway adds, so they must go when the new workers go live. Do this at a quiet time; the apps are down for the few minutes between steps 3 and 5.

1. **Sign-in providers:** sign-in callbacks are now on the new addresses, so add them to each provider before deploying (keep the old ones until the switch is done):
   - Google, GitHub, Onshape: `https://id.<domain>/api/auth/<provider>/callback` (`google`, `github`, `onshape`). Every team's sign-in calls back there; the team travels in the sign-in's state. Steam needs no change: it accepts any return address.
   - Share-A-Cart: Orders now calls back on `https://orders.<domain>/api/share-a-cart/callback`; reconnect it once on Orders' Settings page after the switch.
2. **DNS:** make sure there's a proxied wildcard record for the domain: `*` → AAAA `100::` (proxied, orange cloud). Hostnames with their own records (`www`, the edge box's tunnel) keep them.
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
4. **Sign-in providers:** add `https://id.frcgearbox.com/api/auth/<provider>/callback` for Google, GitHub and Onshape (other teams' sign-ins call back there).
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

G3's apps move from `<app>.g3robotics.com` to `1648-<app>.frcgearbox.com` (its home to `1648.frcgearbox.com`, sign-in to `1648-id.frcgearbox.com`). The old app addresses, and `id.` and `admin.g3robotics.com`, stop working: the gateway answers them `410 Gone` with the new address. `www.g3robotics.com` and the edge box's tunnel are unaffected. Everyone signs in again once, since sessions belong to a domain.

Before merging the release PR that includes the move (it deploys on merge):

1. **frcgearbox.com is set up** (above): zone, `@` and `*` DNS records, the platform Worker, migrations, and team 1648 active in the platform's registry (its first migration adds it).
2. **Sign-in providers:** `https://id.frcgearbox.com/api/auth/<provider>/callback` registered with Google, GitHub and Onshape (Steam needs nothing).
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
- **Edge box:** set `EDGE_WORKER_URL=https://edge.<domain>/api` in `/etc/g3-edge/agent.env` and restart the agent (`sudo systemctl restart g3-edge-agent`).
- **Sign-in providers:** remove the old `api.g3id.<domain>` and `id.<domain>` callback URLs (they're on `id.frcgearbox.com` now).
- **Anything else** (a bookmark, a script, a kiosk) gets a `410` naming its new address, so it's easy to spot in the gateway's logs.

## Other outside services

- **Slack for other teams:** in the Slack app's settings, set its display name to **Gearbot** (`slackBotName` in `site.ts`), turn on distribution (Manage Distribution), add the redirect URL `https://id.frcgearbox.com/api/slack/oauth/callback`, give the bot the scopes `commands, chat:write, im:write, im:history, users:read, users:read.email`, and subscribe to the `app_uninstalled` and `tokens_revoked` events. Then set G3ID's secrets `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (Basic Information → App Credentials) and `SECRETS_KEY` (`openssl rand -base64 32`; keep it, since it decrypts the stored tokens). Team admins connect their workspace on G3ID's Admin → Slack page; G3 can keep its current settings.

