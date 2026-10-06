# G3 Edge — Project Brief

Brief for building the software around the team's on-site Linux box ("the edge box"). The first feature is network usage tracking and control. The box will also host other shop-side services later (e.g. printing over WAN), so everything is named and structured as a general-purpose edge platform with feature modules, not as a "network router" project.

Build incrementally. Phase 1 first; don't scaffold later phases until asked. Follow the monorepo's existing conventions (pnpm workspaces, TypeScript, Hono with RPC, Drizzle, Cloudflare Workers/Pages/D1/KV/R2, kebab-case files, PascalCase components/types, `@g3/*` package names). If anything here conflicts with an existing convention in the repo, follow the repo and flag it.

---

## Context

- FRC Team 1648 (G3 Robotics). Shop internet is a **cellular hotspot with a 50 GB/month cap**, and we keep running out.
- Goal: see which devices use the data, project month-end usage, and block or throttle heavy stuff (video, big downloads) with per-device, time-limited exceptions.
- **Design constraint: the hotspot's data is the scarce resource.** Anything that runs on the box and talks to the internet must be frugal. No chatty polling, no pulling the monorepo or `node_modules` on the box, no hosting the UI on the box.

## Naming

| Thing | Name |
|---|---|
| The physical box | Orange Pi 5, hostname `orangepi5`, login user `g3` (called "the edge box" / `g3-edge` in docs) |
| On-box agent (package) | `devices/edge-agent` → `@g3/edge-agent` |
| Cloud control plane (worker) | `workers/edge` |
| Admin/dashboard UI | `apps/edge` |
| Shared request/response schemas | `packages/edge-protocol` → `@g3/edge-protocol` |
| System config for the box | `infra/edge/` |
| Feature modules (agent + worker + UI) | `network` now; `print` and others later |

"Edge" is the platform. "Network" is the first module. Keep module code separated (e.g. `src/modules/network/*` in the agent and the worker) so a `print` module can be added beside it without touching network code.

## Hardware and current network setup (already working)

- **Box:** Orange Pi 5 (RK3588S, arm64), Ubuntu-based Armbian. Currently boots off a USB drive; will move to NVMe.
- **Topology:** `hotspot → g3-edge (wan0) … g3-edge (lan0) → switch → wired devices + Wi-Fi router in AP mode`
- `wan0`: built-in Ethernet, DHCP from the hotspot.
- `lan0`: USB gigabit adapter, static `192.168.50.1/24`, `ignore-carrier: true`.
- Interfaces are renamed by MAC in `/etc/netplan/10-router.yaml` (renderer: networkd; NetworkManager inactive).
- **dnsmasq** (`/etc/dnsmasq.d/lan.conf`): `interface=lan0`, `bind-dynamic`, `no-resolv`, upstream `1.1.1.1` / `8.8.8.8`, DHCP `192.168.50.100–250`, 12h leases. Leases are at `/var/lib/misc/dnsmasq.leases`. The build supports `nftset`.
- **nftables** (`/etc/nftables.conf`): `inet filter` (input/forward policy drop, LAN→WAN forward allowed, NAT masquerade on `wan0`) plus an accounting table:

```
table inet acct {
  set dl { type ipv4_addr; size 1024; flags dynamic; }
  set ul { type ipv4_addr; size 1024; flags dynamic; }
  chain count {
    type filter hook forward priority -10; policy accept;
    iifname "wan0" oifname "lan0" update @dl { ip daddr counter }
    iifname "lan0" oifname "wan0" update @ul { ip saddr counter }
  }
}
```

- **Current collector:** `/usr/local/bin/g3-usage.py`, run every 5 min by a systemd timer. It reads `nft -j list set inet acct dl|ul` and `/sys/class/net/wan0/statistics/{rx,tx}_bytes`, computes deltas (treating a lower value as a counter reset), maps IP → MAC/hostname from the leases file, and writes to SQLite `/var/lib/g3-router/usage.db` (`last`, `usage` tables). A `_wan` pseudo-client records total WAN bytes, including the box's own traffic. **The agent replaces this script in Phase 1.**
- Timezone: `America/New_York`.
- The live config files should be copied into `infra/edge/` as the source of truth (see Infra rules).

## Architecture

```
            ┌──────────────── Cloudflare ────────────────┐
 browser ──▶│ apps/edge (Pages, G3ID auth)                │
            │        │ Hono RPC                           │
            │        ▼                                    │
            │ workers/edge  ── D1 (state, usage, grants)  │
            │   │  ▲             R2 (agent releases)      │
            └───┼──┼──────────────────────────────────────┘
   commands via │  │ usage push / startup sync
   CF Tunnel +  │  │ (agent → worker, HTTPS)
   Access       ▼  │
            g3-edge: edge-agent (Bun + Hono, 127.0.0.1 only)
                     ├─ modules/network → nftables sets, dnsmasq generated files
                     └─ modules/print (future)
```

- **D1 is the source of truth** for desired state (grants, blocklists, client names) and history (usage).
- **Worker → agent (push):** commands go through a Cloudflare Tunnel to the agent's local HTTP API. No polling.
- **Agent → worker (push):** usage batches every 5 minutes. On startup or reconnect, the agent makes one request for the full desired state and applies it (reconcile). That one request is the only "pull."
- **If a push to the agent fails** (box rebooting, hotspot down), the change is already saved in D1, and the agent picks it up at its next startup sync. The UI should show "pending" for changes not yet acknowledged by the agent.
- **Offline behavior:** the box keeps routing and enforcing its last-known state with no cloud connection. nftables timeouts make grants expire on their own. The agent buffers usage samples locally and uploads them later.

## Security

> **As built (differs from the original plan below):** one edge device, one shared key (`EDGE_AGENT_KEY`) sent as `Authorization: Bearer` in both directions, no HMAC, and no Cloudflare Access. The tunnel (`edge-agent.g3robotics.com`) forwards the authenticated print and door-sound module routes plus `POST /sync`, which carries no data: it tells the agent to fetch the desired state from the worker with its own key. Every agent→worker response also carries `X-G3-State-Version`, so a missed poke is caught within 5 minutes. No SSH through the tunnel; SSH on `wan0` stays open for now (`# TEMP` rule in `nftables.conf`, to remove before go-live).

~~**Worker → agent** (the tunnel hostname, e.g. `edge-api.g3robotics.com`) has two layers:~~
1. ~~Cloudflare Access on the hostname with a service token.~~
2. ~~HMAC-SHA256 over `method + path + timestamp + body`.~~

~~**Agent → worker:** HMAC with a separate per-device secret.~~

**Other rules:**
- The agent's HTTP server binds to `127.0.0.1` only. cloudflared is the only way in.
- The tunnel also exposes SSH behind Cloudflare Access (for admins). That's a manual setup; document it in `infra/edge/README.md`.
- Store secrets in Workers secrets and in a root-readable env file on the box (`/etc/g3-edge/agent.env`, mode 600). Never commit them.

## Agent (`devices/edge-agent`)

- **Runtime:** Bun + Hono. Ship it as a single binary via `bun build --compile --target=bun-linux-arm64`. The box needs no Node or Bun installed.
- **systemd:**
  - Runs as a dedicated user `g3-edge` with `AmbientCapabilities=CAP_NET_ADMIN` (for nft).
  - `Restart=always`.
  - The binary lives at `/opt/g3-edge/current` → a symlink into `/opt/g3-edge/versions/<version>`.
- **Local state:** SQLite at `/var/lib/g3-edge/agent.db`. This is the usage buffer plus the last-applied desired state. Use `bun:sqlite`.
- **Structure:** `src/core/*` (config, HMAC, HTTP server, sync, update) and `src/modules/network/*`. Modules register their own routes and startup hooks with core.
- **What the agent may touch on the system:**
  - nftables objects inside its **own table** (`inet g3`), plus reading `inet acct`. It never touches `inet filter` or runs `flush ruleset`.
  - Its own generated files: `/etc/dnsmasq.d/g3-edge-*.conf`. After changing them it may reload dnsmasq.
  - Nothing else. Base netplan, nftables, and dnsmasq configs are manual (see Infra rules).

### Core endpoints (agent, via tunnel)
- `GET /health`: version, uptime, module status.
- `POST /sync`: the worker asks the agent to re-fetch and apply desired state.
- `POST /update`: Phase 3; see Updates.

### Network module
- **Collector:** replaces `g3-usage.py`. Every 5 minutes it reads the `acct` sets and `wan0` statistics, computes deltas with reset handling, attributes them by **MAC** (IP → MAC from leases), stores the result locally, and pushes to the worker. Unsent batches are retried with backoff. Usage is keyed by MAC because IPs change.
- **Per-site stats** (added after Phase 1; admin-only): `inet acct` also has `flows_dl`/`flows_ul` sets keyed `client . remote IP` (1h timeout). The agent attributes their byte deltas to the domain the client looked up (dnsmasq `log-queries=extra` → `/run/g3-edge-dns/queries.log`), reduced to the registrable domain (`tldts`), or `(unknown)`. It deletes flow entries idle since the last reading so re-created entries start from zero; this is its only write to `inet acct`. Hourly per-device top-20 sites (rest as `(other)`) go to `net_site_usage`; rolled up to daily after 30 days, deleted after a year.
- **As built (Phase 2):** admins make custom blocklists (no built-in categories), each `block` or `throttle` (per-device rate). The agent owns `inet g3` (built in `enforce.ts`): `bl<id>_ips` sets filled by dnsmasq `nftset=`, `bl<id>_ok` grant sets (MAC → current IP, nft timeout = time left), reject/police rules, and DNS hardening (port-53 redirect, DoT/DoH blocks, NXDOMAIN for the Firefox canary and iCloud Private Relay). Its dnsmasq config lives in `/var/lib/g3-edge/dnsmasq/g3-edge.conf` (not `/etc/dnsmasq.d/`); a systemd path unit restarts dnsmasq when it changes, so the agent needs no privileges for that. `nftables.conf` deletes only its own tables on reload so `inet g3` survives. QUIC is not blocked globally (IP-based rules already cover it). Grants are admin-only (1h / 4h / rest of today); enforcement and hardening are UI switches. Big-download rule and alerts are deferred.
- **Grants** (Phase 2): nftables sets in `inet g3` with `flags timeout`, e.g. `video_ok` and `bigdl_ok`. A grant is `nft add element … { <ip> timeout <remaining> }`, where the remaining time is computed from `expires_at`. Because grants are stored by MAC in D1, the agent resolves MAC → current IP when applying, and re-applies when a device's lease changes IP.
- **Blocklists** (Phase 2): categories of domains (e.g. `video`, `updates`, custom) managed from the UI. The agent writes `/etc/dnsmasq.d/g3-edge-blocklist.conf` using `nftset=/domain/.../4#inet#g3#<category>_ips` and reloads dnsmasq. nftables rules in `inet g3` drop or throttle traffic to `<category>_ips` unless the client's IP is in the matching grant set.
- **DNS bypass hardening** (Phase 2, when blocking is on): redirect LAN port 53 to the box; block QUIC (UDP 443) so traffic falls back to TCP; return NXDOMAIN for `use-application-dns.net` and `mask.icloud.com`; block known DoH endpoints.
- **Big-download rule** (Phase 2, optional): per-connection byte threshold using `ct reply bytes`, exempt for the `bigdl_ok` set. Prefer throttling over dropping where practical.

## Worker (`workers/edge`)

- Hono with RPC, Drizzle on D1, G3ID for auth (match how other workers validate G3ID sessions and roles).
- **Routes for the UI** (G3ID session): overview, clients, usage queries, grants CRUD, blocklist CRUD, device status, (later) trigger update.
- **Routes for agents** (device HMAC): `POST /agent/usage` (batched samples, idempotent by `(device, mac, ts)`), `GET /agent/state` (full desired state).
- **Commands to agents:** a small client that signs requests and calls the agent over the tunnel hostname. It writes D1 first, then pushes, then marks the change acknowledged or pending.

### D1 schema (starting point; adjust to repo conventions)
- `edge_devices`: id, name, tunnel hostname, agent version, last_seen_at, secret reference.
- `net_clients`: mac (PK per device), device_id, hostname (from DHCP), display_name, owner_user_id (nullable, G3ID user), is_infrastructure, first_seen_at, last_seen_at.
- `net_usage`: device_id, mac, ts (5-min bucket), dl_bytes, ul_bytes. `_wan` is a pseudo-client. After ~14 days, roll 5-min rows up into `net_usage_hourly` and delete the raw rows (cron trigger).
- `net_grants`: id, device_id, mac, kind (`video` | `bigdl` | …), expires_at, created_by, reason, acked_at.
- `net_blocklist`: id, device_id, category, domain, enabled.
- `net_settings`: monthly cap bytes (default 50 GB), billing cycle start day, alert thresholds.
- `edge_releases` (Phase 3): version, r2_key, sha256, created_at.
- `edge_audit`: who did what, and when.

### Projections
- Month-to-date total uses `_wan`, since it's closest to what the carrier bills, measured from the billing-cycle start day.
- The projection is a simple run rate or linear fit over the current cycle, plus a "last 7 days pace" variant. Keep it simple; no forecasting libraries.
- Alerts (Phase 2): send a Slack or Discord webhook when the projection crosses a threshold (default 45 GB) or a client spikes. Send each alert once per cycle per threshold.

## UI (`apps/edge`)

- React + Vite on Pages, G3ID login, following existing app patterns in the monorepo.
- **Roles:** admins/mentors can manage everything; members can see overall usage and their own devices. Map these to existing G3ID roles and ask if unclear.
- **Pages:**
  - **Overview:** cycle usage bar vs cap, projection, daily chart, top clients.
  - **Clients:** leaderboard, rename, mark as infrastructure, assign owner.
  - **Client detail:** usage history, active grants.
  - **Grants:** "allow video / big downloads for 1h / 4h / today."
  - **Blocklists.**
  - **Devices:** agent status, version, last seen; later, the update button.
- Structure the navigation by module ("Network" now) so "Print" can slot in later.

## Updates (Phase 3)

- **CI:** a GitHub Action builds the agent binary, uploads it to R2, and registers `edge_releases` with its sha256.
- **Flow:** UI "Update" → worker → `POST /update {version, url, sha256}` → agent downloads (a few MB), verifies the hash, writes `versions/<v>`, flips the `current` symlink, and exits so systemd restarts it.
- **Rollback:** keep the previous version. If the new version doesn't report healthy within ~60s, or crash-loops, an `OnFailure=` unit or wrapper flips the symlink back. The agent reports its version on startup so the worker can confirm.
- The box never runs `git`, `pnpm`, or builds anything.

## Infra rules (`infra/edge/`)

- Contains `netplan/10-router.yaml`, `nftables.conf`, `dnsmasq.d/lan.conf`, the systemd units for the agent and cloudflared, and a `README.md` with setup steps from a fresh Armbian flash.
- These are **applied manually over SSH**, never by the agent. A bad netplan or nftables change can cut the box off from the internet, and then it can't receive a fix.
- Include a `check.sh` that runs `nft -c -f` and `dnsmasq --test` before any apply.
- Leave out real MAC addresses and secrets (use placeholders plus a local, uncommitted override).

## Data budget rules (apply everywhere)

- No agent polling. Pushes happen at most every 5 minutes, with keep-alive connections and compact JSON batches.
- The UI is never served from the box.
- Agent updates are a single binary download, triggered on demand only.
- Tunnel idle traffic is acceptable, but the WAN-minus-clients gap in usage data should be checked after the tunnel goes live to confirm the box's own overhead stays small.

## Phases

1. **Visibility:** `packages/edge-protocol`, the agent (core + network collector + push + local buffer), the worker (agent auth, usage ingest, `edge_devices` / `net_clients` / `net_usage` / `net_settings`), and the UI (overview, clients, devices; read-only except renaming clients). Install the agent via a manual script in `infra/edge/` and retire `g3-usage.py`.
2. **Control:** the tunnel plus Access for the agent API, commands, grants, blocklists, DNS hardening, alerts.
3. **Updates:** CI releases, the update endpoint, rollback.
4. **Later modules:** `print` (printing over WAN) and others, reusing core (auth, tunnel, sync, updates).

### Print module (as built)

- Drop-in replacement for the old shoppi-print server on the same box. The Shop SW's `POST /print?title=` is unchanged; the shop worker now forwards to the edge worker through a service binding and forces one-sided black and white on the default printer.
- **No caching or storage**: the edge worker streams the file through the tunnel straight to the agent, which pipes it to `lp`. There's no R2 and no job table. If the box is unreachable, the request fails immediately (503).
- CUPS on the box is the source of truth for printers and the queue. The Edge UI (**Print**) lets anyone print a file with options (copies, sides, color, paper, pages) and see the queue; admins find printers (DNS-SD via `lpinfo`), add them driverless (`lpadmin -m everywhere`), set the default, send a test page, resume, and remove.
- The agent's module routes are behind the shared key; the tunnel forwards only `^/(print|lookup|switch|sync)`.

### Shop drive (as built)

- A shared 10 GB "drive" on the box for big files, so they only come over the hotspot once. Served by the agent's `drive` module **directly on the LAN** at `http://drive.local` (mDNS, with a dnsmasq fallback) and `http://192.168.50.1`, port 80, on the LAN address only. It's never exposed through the tunnel, so file bytes never cross the internet. This is a deliberate exception to "the UI is never served from the box": the page uses no WAN data.
- No login (low-risk files): anyone on the shop network can upload, download (resumable), and delete. Flat file list; clashing names become `name (1).ext`.
- Storage is a loop-mounted ext4 image (`/var/lib/g3-drive.img` at `/srv/g3-drive`), so it can't fill the main disk; the agent refuses to store files if it isn't mounted. Not backed up.
- The Edge dashboard's **Drive** page just links there: an https page can't call a plain-http LAN address, and HTTPS on the box would need a public DNS record and certificate, which wasn't worth it for unauthenticated files.

## Open questions to confirm with Gray before building
- Exact G3ID role names for admin vs member, and how other workers check them.
- The hotspot's billing cycle start day.
- Whether the tunnel hostname should live on `g3robotics.com` or a separate internal zone.
- Slack vs Discord for alerts.
