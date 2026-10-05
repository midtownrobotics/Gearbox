# Deploying

Every app is one Cloudflare Worker that serves the app's page and its API at `/api` on the app's own address (`https://orders.<domain>` and `https://orders.<domain>/api`). One more worker, the **gateway** (`workers/gateway`), owns `*.<domain>/*` and sends each request to its app's worker by hostname. Cloudflare Pages isn't used.

```
browser ──> *.<domain> ──> gateway ──(service binding)──> orders worker ──> /api/*  → Hono routes
                                                                        └─> anything else → the built app (apps/orders/dist)
```

- The gateway also answers each app's **old API address** (`api.orders.<domain>/x` → the app's `/api/x`), so services set up with it keep working: Slack's commands and events, Onshape's webhook, the edge box. Hostnames that aren't apps (`www`, the edge box's tunnel) pass through untouched.
- Teams have their own addresses too: `<number>-<app>.<domain>` and `<number>.<domain>` (the team's home). The gateway keeps each team's sessions and API calls to its own hosts and tells the app the team and user in `X-Team-Id` / `X-User-*` headers. App workers have no workers.dev address in production (`workers_dev = false`), so those headers can only come from the gateway.
- An app worker's own code only runs for `/api/*` (`run_worker_first` in its `wrangler.toml`); everything else is static files, with unknown paths falling back to `index.html` for the app's router. Workers call each other through service bindings at `/api` too (`http://g3id/api/auth/me`). A page calls another app's API at `/api/~<app>/…` on its own address (`apiPath` in `@g3/site-config`), which the gateway sends to that app for the same team.

## Deploying a change

```bash
pnpm run deploy                               # every app worker, then the gateway
pnpm --filter @g3/worker-orders run deploy    # one app: builds apps/orders, then deploys it
```

Each app worker uploads `apps/<app>/dist` with it, so its `wrangler.toml` has a production build command (`[env.production.build]`) that builds the app first, whoever runs `wrangler deploy --env production` or `wrangler versions upload --env production`. Deploy with `--env production` only (the scripts do). If your Cloudflare login can see several accounts, set `CLOUDFLARE_ACCOUNT_ID` first.

Apply D1 migrations before deploying a worker that needs them (`pnpm db:migrate:remote`).

Cloudflare's Git builds (Workers Builds) need no extra setup: their `wrangler deploy` / `wrangler versions upload --env production` runs the same build command. Leave their build command empty.

## Switching over from Pages and per-app API domains (once)

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
6. **Check:** sign in with each provider; open each app; `https://<app>.<domain>/api/health` and `https://api.<app>.<domain>/health` both answer with the app's version.

Later, move outside services to the new addresses one at a time, then drop the old ones:

- **Sign-in providers:** remove the old `api.g3id.<domain>` callback URLs.
- **Slack app:** change the slash command and event URLs to `https://g3id.<domain>/api/slack/...`.
- **Onshape webhook:** re-register it from Shop's admin page (it registers at the new address).
- **Edge box:** set `EDGE_WORKER_URL=https://edge.<domain>/api` in `/etc/g3-edge/agent.env` and restart the agent.

When nothing uses an `api.<app>` address anymore, set its `api` to `null` in `site.ts`.
