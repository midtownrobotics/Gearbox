# Edge box setup

System config and install scripts for the shop's edge box, an Orange Pi 5 running Armbian (hostname `orangepi5`, login user `g3`). See [docs/edge.md](../../docs/edge.md) for the full design.

**Everything here is applied by hand over SSH. The agent never applies any of it.** A bad netplan or nftables change can cut the box off from the internet, and then it can't receive a fix.

From the shop LAN, the box is always at `192.168.50.1`:

```bash
ssh g3@192.168.50.1
```

## What's here

Files under `etc/` mirror where they go on the box.

| Path | Purpose |
|---|---|
| `etc/netplan/10-router.yaml` | Names and configures `lan0` (USB adapter, `192.168.50.1/24`) only |
| `etc/systemd/network/10-wan0.link` | Names the built-in port `wan0` (matched by hardware path) and pins its MAC, so the hotspot's DHCP lease is stable |
| `etc/systemd/network/20-wan0.network` | DHCP on `wan0` |
| `etc/sysctl.d/99-router.conf` | Turns on IPv4 forwarding |
| `etc/nftables.conf` | Firewall, NAT, and the `inet acct` byte counters the agent reads (per client, and per client and remote IP for site stats). Reloading it leaves the agent's own `inet g3` table alone. |
| `etc/dnsmasq.d/lan.conf` | DHCP and DNS for the LAN, the query log used for site stats, an include of the agent's generated config, and `drive.local` |
| `etc/tmpfiles.d/g3-edge.conf` | Creates `/run/g3-edge-dns/` at boot for the query log (kept in RAM), and `/var/lib/g3-edge/dnsmasq/` for the agent's generated dnsmasq config |
| `etc/logrotate.d/g3-edge-dns` | Rotates the query log daily |
| `etc/systemd/system/g3-edge-agent.service` | Runs the agent as user `g3-edge` with only `CAP_NET_ADMIN` (nft) and `CAP_NET_BIND_SERVICE` (the shop drive on port 80) |
| `etc/systemd/system/g3-edge-dnsmasq.{path,service}` | Restarts dnsmasq (after `dnsmasq --test`) when the agent changes its generated config, so the agent needs no extra privileges |
| `etc/systemd/system/g3-door-gpio.service` | Configures Orange Pi 5 GPIO2_D4 as a pulled-up input before the agent starts |
| `etc/systemd/system/g3-drive-mdns.service` | Announces `drive.local` on the shop network over mDNS |
| `setup-drive.sh` | Creates and mounts the 10 GB shop drive (one-time) |
| `etc/g3-edge/agent.env.example` | Template for `/etc/g3-edge/agent.env` (agent config and shared key; root-only, mode 600) |
| `install-agent.sh` | Installs or upgrades the agent binary |
| `check.sh` | Validates nftables, dnsmasq, and netplan configs before you apply them |
| `local/` | **Gitignored.** The real files from the box, in the same layout |

This repo is public. The committed `10-router.yaml` uses placeholder MACs (`02:00:00:00:00:0x`); the real one is in `local/`. Every other file is the same in both places. `check.sh` uses the `local/` copy of a file when there is one.

SSH to the box works from the shop LAN, and for now also on `wan0` (the `# TEMP` rule in `nftables.conf`). Remove that rule, from both copies, before going live.

## First deployment

Do these in order. Steps 1–5 are from a dev machine logged in to Cloudflare (`wrangler login`). Steps 6–12 need to be on the shop LAN.

### Cloud

1. **Database.** Run the command below, then put the `database_id` it prints into `[[env.production.d1_databases]]` in `workers/edge/wrangler.toml`. Commit that change.
   ```bash
   pnpm --filter @g3/worker-edge exec wrangler d1 create g3-edge-prod
   ```
2. **Tables.**
   ```bash
   pnpm --filter @g3/worker-edge run db:migrate:remote
   ```
3. **Shared agent key.** Generate a key and save it somewhere safe; the box needs it in step 7.
   ```bash
   openssl rand -hex 32
   pnpm --filter @g3/worker-edge exec wrangler secret put EDGE_AGENT_KEY --env production
   ```
4. **Worker.** Deploy it; this also sets up `api.edge.g3robotics.com`. Check it with `curl https://api.edge.g3robotics.com/health`.
   ```bash
   pnpm --filter @g3/worker-edge run deploy
   ```
5. **UI.** Create a Cloudflare Pages project connected to this repo, like the other apps:
   - Build command: `pnpm --filter @g3/edge run build`
   - Output directory: `apps/edge/dist`
   - Custom domain: `edge.g3robotics.com`

   The API and G3ID URLs come from `apps/edge/.env.production`, so no environment variables are needed. G3ID already allows redirects to any `*.g3robotics.com` site.

### Box

6. **Copy files.** Build the agent and copy it with this folder to the box. It's about 80 MB, so do it over the LAN.
   ```bash
   pnpm --filter @g3/edge-agent run build
   rsync -a infra/edge/ devices/edge-agent/dist/g3-edge-agent g3@192.168.50.1:~/edge-infra/
   ssh -t g3@192.168.50.1
   cd ~/edge-infra
   ```
7. **Install the agent.**
   ```bash
   sudo ./install-agent.sh ./g3-edge-agent 0.1.0
   ```
   The first run creates `/etc/g3-edge/agent.env` and stops. Put the key from step 3 in `EDGE_AGENT_KEY` (`sudo nano /etc/g3-edge/agent.env`) and run the same command again. The agent then starts and reports usage. Site tracking waits until steps 8–10 are done.
8. **Validate the configs.**
   ```bash
   sudo ./check.sh
   ```
9. **Query log.** This needs the `g3-edge` user from step 7.
   ```bash
   sudo cp etc/tmpfiles.d/g3-edge.conf /etc/tmpfiles.d/
   sudo systemd-tmpfiles --create /etc/tmpfiles.d/g3-edge.conf
   sudo cp etc/logrotate.d/g3-edge-dns /etc/logrotate.d/
   sudo cp local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/
   sudo systemctl restart dnsmasq
   sudo ls -l /run/g3-edge-dns/                       # queries.log, group g3-edge, -rw-r-----
   sudo -u g3-edge tail -3 /run/g3-edge-dns/queries.log  # the agent can read it; lines appear as devices browse
   ```
10. **Flow counters.** Reloading resets the existing byte counters, which the agent handles.
    ```bash
    sudo cp local/etc/nftables.conf /etc/nftables.conf
    sudo nft -f /etc/nftables.conf
    sudo nft list set inet acct flows_dl | head
    ```
11. **Check the agent.** Wait 5 minutes, then:
    ```bash
    curl -s http://127.0.0.1:8700/health
    ```
    The health output should show `lastSitesError: null`, `lastDnsAnswers` above 0, and `trackedFlows` above 0.
12. **Clean up the old collector** (see below).

Usage appears on the Overview page within 10 minutes. The first hour of site stats appears on the Sites page about 70 minutes after step 10.

## Printing rollout (replaces shoppi-print)

Printing goes: Shop SW or Edge UI → `workers/edge` → Cloudflare Tunnel (`edge-agent.g3robotics.com`) → the agent's print module → CUPS on the box → the printer. Nothing is stored along the way. If the box can't be reached, printing fails right away with a clear error.

This replaces the old print server behind `shoppi-print.g3robotics.com`, which ran on a separate device (not this box) and is retired in step 10.

### Box prerequisites

1. **CUPS and printer discovery.** CUPS is probably already installed for shoppi-print. Install whatever is missing (one-time, about 50–100 MB over the hotspot):
   ```bash
   sudo apt install cups cups-filters avahi-daemon
   sudo systemctl enable --now cups avahi-daemon
   ```
   `avahi-daemon` lets CUPS find printers on the shop network (DNS-SD) and set them up without drivers.

### Tunnel

The worker reaches the agent through a Cloudflare Tunnel. If shoppi-print already uses a tunnel on this box, add the new hostname to that tunnel instead of creating another one.

2. **Create or reuse a tunnel.** In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels**. To create one, choose **Cloudflared**, name it `g3-edge`, and run the `sudo cloudflared service install <token>` command it shows on the box. The token is a secret; don't commit it.
3. **Add a public hostname** to the tunnel:
   - Subdomain `edge-agent`, domain `g3robotics.com`
   - Path: `^/(print|switch|sync)(/.*)?$` (only these agent routes are reachable; `/health` stays local)
   - Service: `HTTP`, URL `localhost:8700`
4. **Check it** from any machine. You should get `401`: the tunnel reached the agent, and the agent refused because there's no key.
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://edge-agent.g3robotics.com/print/printers
   ```

### Deploy

5. **Edge worker.** It now calls `https://edge-agent.g3robotics.com` (`EDGE_AGENT_URL` in `wrangler.toml`) with the existing `EDGE_AGENT_KEY`.
   ```bash
   pnpm --filter @g3/worker-edge run deploy
   ```
6. **Agent 0.2.0 or later** (currently 0.3.0). This adds the print module and puts `g3-edge` in the `lpadmin` group so it can manage printers.
   ```bash
   pnpm --filter @g3/edge-agent run build
   rsync -a infra/edge/ devices/edge-agent/dist/g3-edge-agent g3@192.168.50.1:~/edge-infra/
   ssh -t g3@192.168.50.1 'cd ~/edge-infra && sudo ./install-agent.sh ./g3-edge-agent 0.3.0'
   ```
7. **Set up the printer** in the Edge UI under **Print → Printers**. Click **Find printers**, then **Add** next to the shop printer; the first printer added becomes the default. If it isn't found, add it by IP address. Then click **Print test page**.

   If shoppi-print already created a CUPS queue for this printer, it shows up here too. You can make it the default instead of adding the printer again.
8. **Try a print** from **Print → Print** in the Edge UI.
9. **Switch the Shop SW over.** Deploy the shop worker. Its `/print` route now sends jobs to the edge worker (one-sided, black and white, default printer) through the `EDGE` service binding, instead of to shoppi-print.
   ```bash
   pnpm --filter @g3/worker-shop run deploy
   ```
   Print a drawing from the Shop SW Files page to confirm.

### Retire shoppi-print

10. Once shop printing works through the edge box:
    - stop and disable the old print server's service on the box;
    - remove the `shoppi-print.g3robotics.com` hostname from its tunnel (and the tunnel itself, if nothing else uses it);
    - delete the shop worker's old secret: `pnpm --filter @g3/worker-shop exec wrangler secret delete PRINT_TOKEN --env production`.

### Troubleshooting

- **"The edge box isn't reachable"**: check the tunnel (step 4), `systemctl status cloudflared`, and `systemctl status g3-edge-agent` on the box.
- **"rejected the worker's key"**: `EDGE_AGENT_KEY` in `/etc/g3-edge/agent.env` doesn't match the worker secret.
- **Printer shows "Stopped"**: CUPS pauses a printer after errors, for example if it was off. Click **Resume** on the Printers page once it's back.
- **On the box**: `lpstat -p -d` lists printers and the default; `lpstat -o` lists queued jobs; CUPS logs to the journal: `sudo journalctl -u cups -n 50`.

## Shop drive (http://drive.local)

A shared 10 GB folder on the box for big files, so they only come over the hotspot once. The box serves it on the shop network at `http://drive.local` (and `http://192.168.50.1`), and the Edge dashboard's **Drive** page links there. Uploads and downloads go directly between devices and the box: it's never reachable through the tunnel, and the firewall drops port 80 from `wan0`.

There's **no login**: anyone on the shop network can upload, download, and delete. It's a 10 GB filesystem image mounted at `/srv/g3-drive`, so filling it can't fill the box's main disk. If the image isn't mounted, the agent refuses to store anything rather than writing to the main disk. Files aren't backed up.

1. **Agent 0.2.0 or later** (`install-agent.sh`, as in "Printing rollout" step 6). Its systemd unit now allows port 80 and writing to `/srv/g3-drive`.
2. **Create the drive.** This makes the 10 GB image, adds it to `/etc/fstab`, mounts it, installs `avahi-utils` if needed, starts the `drive.local` mDNS announcement, and restarts the agent:
   ```bash
   cd ~/edge-infra && sudo ./setup-drive.sh
   ```
3. **DNS fallback.** `drive.local` is mostly resolved over mDNS. The `address=/drive.local/…` line in `lan.conf` covers devices that ask regular DNS instead:
   ```bash
   sudo ./check.sh
   sudo cp local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/ && sudo systemctl restart dnsmasq
   ```
   Before copying, check that the box's current `/etc/dnsmasq.d/lan.conf` has no lines that `local/` is missing, for example a `conf-dir=` line from the Phase 2 branch. `diff local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/lan.conf` shows any difference.
4. **Optional: keep mDNS on the shop side only.** By default avahi also announces on `wan0` (the hotspot's network). To limit it to the LAN:
   ```bash
   sudo sed -i 's/^#\?allow-interfaces=.*/allow-interfaces=lan0/' /etc/avahi/avahi-daemon.conf
   sudo systemctl restart avahi-daemon g3-drive-mdns
   ```
5. **Check it.** On the box, `curl -s http://127.0.0.1:8700/health` should show the `drive` module with `"listening": true` and `"storage": { "ok": true, ... }`. Then open `http://drive.local` from a laptop or phone on the shop network.

If `drive.local` doesn't load on a device (some Android phones don't do mDNS), use `http://192.168.50.1`.

## Phase 2 rollout (blocklists, exceptions, DNS hardening)

For a box already running everything above (Phase 1, printing, and the shop drive). Do the cloud steps first: a new agent talking to an old worker just logs sync errors until the worker is updated.

### Cloud

1. **Database.** Apply the new migration (`0003_control.sql`):
   ```bash
   pnpm --filter @g3/worker-edge run db:migrate:remote
   ```
2. **Worker.** Deploy it. Besides printing, the worker now pokes the agent at `https://edge-agent.g3robotics.com/sync` whenever blocklists, exceptions, or the switches change.
   ```bash
   pnpm --filter @g3/worker-edge run deploy
   ```
3. **UI.** Push the branch so Pages rebuilds. Admins get **Network → Controls**, plus an **Exceptions** card on each device's page and a **Tunnel** card on the Edge Box page.

### Tunnel

4. **Nothing to set up.** Printing already uses the `edge-agent.g3robotics.com` tunnel hostname, and its path rule `^/(print|switch|sync)(/.*)?$` already covers `/sync`. Check it from any machine; it should return `401` (the tunnel reached the agent; there's no key):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://edge-agent.g3robotics.com/sync
   ```
   The **Tunnel** card on the Edge Box page runs the same check and should say **Connected**. Pokes are only a speed-up: without them the box still picks up changes within 5 minutes, since every upload response tells it the current settings version.

### Box

5. **Install agent 0.3.0.** From the repo root:
   ```bash
   pnpm --filter @g3/edge-agent run build
   rsync -a infra/edge/ devices/edge-agent/dist/g3-edge-agent g3@192.168.50.1:~/edge-infra/
   ssh -t g3@192.168.50.1
   cd ~/edge-infra
   sudo ./install-agent.sh ./g3-edge-agent 0.3.0
   ```
   This also installs the dnsmasq restart units and creates `/var/lib/g3-edge/dnsmasq/`. The agent writes its dnsmasq config there, but dnsmasq ignores it until step 7.
6. **Validate:** `sudo ./check.sh`
7. **Apply the base config changes.** nftables no longer clears the agent's table on reload, and dnsmasq includes the agent's config (the `drive.local` line and the temporary SSH-on-`wan0` rule are unchanged). Check with `diff local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/lan.conf` first: the only difference should be the new `conf-dir=` block.
    ```bash
    sudo cp local/etc/nftables.conf /etc/nftables.conf
    sudo nft -f /etc/nftables.conf
    sudo cp local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/
    sudo systemctl restart dnsmasq
    ```
8. **Check.** The first command should list `table inet g3`. In the health output, `enforcement` should show `lastSyncError: null` and `appliedStateVersion` matching the version shown on the Edge Box page.
    ```bash
    sudo nft list tables
    curl -s http://127.0.0.1:8700/health
    ```
9. **Try it.** In the UI, create a small blocklist (for example `example.com`), turn on **Enforce blocklists**, and open that site from a device on the shop network. It should fail to load within a few seconds; a device may need up to 5 minutes if it had the site's address cached. Then give that device an exception, and the site should load.

To see what the agent has applied on the box:
```bash
sudo nft list table inet g3                           # rules; blocklist sets fill as devices look up sites
sudo cat /var/lib/g3-edge/dnsmasq/g3-edge.conf        # generated dnsmasq config
```

**If something goes wrong:** turn off **Enforce blocklists** and **DNS hardening** in the UI; the box removes all blocking within seconds (or 5 minutes without the tunnel). If the UI or internet is unavailable, on the box: `sudo nft delete table inet g3` removes blocking until the agent's next cycle, and `sudo systemctl stop g3-edge-agent` keeps it off.

## Door microswitch sounds

The agent's `switch` module reads **GPIO2_D4** on the Orange Pi 5: physical header pin 22,
wiringOP pin 13, Linux GPIO 92. Wire the microswitch between physical pin 22 and a GND pin
(pin 20 is adjacent). The door is closed when the switch shorts the input to ground. The setup
script enables the internal pull-up, so opening the door changes the input high and plays a WAV
file. Never connect the GPIO pin to 5 V.

A 75 ms debounce prevents contact bounce from playing duplicates; closing the door rearms the
next opening. If the agent starts while the door is already open, it records that initial state
without playing a startup sound.

1. Ensure wiringOP's `gpio` command and ALSA's `aplay` are installed. The Orange Pi images
   normally include wiringOP; `aplay` is provided by `alsa-utils`. Connect powered speakers
   to the Orange Pi 5's 3.5 mm audio jack.
2. Run `install-agent.sh`. It installs `prepare-switch-gpio.sh`, gives the `g3-edge` service user
   GPIO read and audio-device access, and creates writable `/srv/g3-sounds` storage.
3. The default ALSA device is the Orange Pi 5's ES8388 analog audio jack. Check that the card
   appears with `aplay -l`. If your image gives it a different card ID, set
   `EDGE_SWITCH_AUDIO_DEVICE` in `/etc/g3-edge/agent.env` to the matching `plughw:CARD=...,DEV=0`
   value and restart the agent. For the usual card ID, add this line to that file:

   ```dotenv
   EDGE_SWITCH_AUDIO_DEVICE=plughw:CARD=rockchipes8388,DEV=0
   ```

   ```bash
   sudo systemctl restart g3-edge-agent
   ```

   Verify the same output outside the app with
   `sudo -u g3-edge aplay -q -D 'plughw:CARD=rockchipes8388,DEV=0' test.wav`.
4. In the Edge web app, open **Edge Box → Door Sounds** as an admin. Upload RIFF/WAVE files up to
   10 MB, then use **Test on Orange Pi** to confirm the selected audio output. Uploaded files join
   the door-opening rotation immediately and survive agent upgrades.
5. In the Cloudflare tunnel's public-hostname route, ensure the path is
   `^/(print|switch|sync)(/.*)?$`; older installs may still have a rule without `switch`.

`EDGE_SWITCH_SOUNDS` can additionally name comma-separated WAV paths outside the managed upload
directory. Optional paths, polling, debounce, and player overrides are documented in
`agent.env.example`.

In mock mode only, simulate closing and opening through the authenticated local API:

```bash
curl -X POST http://127.0.0.1:8700/switch/input \
  -H "Authorization: Bearer $EDGE_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"grounded":true}'
curl -X POST http://127.0.0.1:8700/switch/input \
  -H "Authorization: Bearer $EDGE_AGENT_KEY" -H "Content-Type: application/json" \
  -d '{"grounded":false}'
```

`GET /switch/state` and the normal `/health` response report the input state, trigger count,
last sound, and GPIO or playback errors.

## Changing the network config later

1. Edit the file in `local/`, and make the same change to the committed copy (keeping placeholder MACs).
2. Copy this folder to the box (`rsync` as in step 6) and run `sudo ./check.sh`.
3. Apply one file at a time on the box:
   - **netplan (`lan0`):** `sudo cp local/etc/netplan/10-router.yaml /etc/netplan/ && sudo netplan try`. `netplan try` rolls back automatically unless you confirm within 120 seconds, so a mistake can't lock you out.
   - **`wan0` (`10-wan0.link`, `20-wan0.network`):** `netplan try` doesn't cover these, so keep the HDMI keyboard handy. Copy them to `/etc/systemd/network/`, then check the `.link` file parses (no "Unknown key" lines): `sudo udevadm test-builtin net_setup_link /sys/class/net/wan0 2>&1 | grep -iE "unknown|wan0.link|MAC"`. `.network` changes apply with `sudo networkctl reload`; `.link` changes (name, MAC) apply at the next boot.
   - **nftables:** `sudo cp local/etc/nftables.conf /etc/ && sudo nft -f /etc/nftables.conf`
   - **dnsmasq:** `sudo cp local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/ && sudo systemctl restart dnsmasq`

The agent relies on:
- the `inet acct` table and its sets `dl`, `ul`, `flows_dl`, and `flows_ul`;
- the flows sets keeping a timeout of at least 1 hour;
- the interfaces being named `wan0` and `lan0`;
- the query log staying at `/run/g3-edge-dns/queries.log` and being rotated in `create` mode (not `copytruncate`);
- `nftables.conf` never using `flush ruleset`, which would delete the agent's `inet g3` table (the agent recreates it within 5 minutes, but blocking stops until then);
- `lan.conf` keeping its `conf-dir=/var/lib/g3-edge/dnsmasq/,*.conf` line.

Reloading `nftables.conf` resets the `inet acct` counters. The agent handles this.

## Upgrading the agent

Run steps 6 and 7 again with a new version number. The previous version stays in `/opt/g3-edge/versions/`, so rolling back is:

```bash
sudo ln -sfn versions/<old> /opt/g3-edge/current && sudo systemctl restart g3-edge-agent
```

### Upgrade from Windows (PowerShell)

Run these commands from the repo root in PowerShell while connected to the shop LAN. Install Bun, Node.js (which includes Corepack), and the Windows OpenSSH client first if they are not available. Open a new PowerShell window after installing them so `bun`, `corepack`, `ssh`, and `scp` are on `PATH`.

The first command builds a Linux ARM64 binary on Windows; it does not deploy anything by itself. `corepack pnpm` avoids requiring a separate global pnpm installation.

```powershell
corepack pnpm --filter @g3/edge-agent run build
ssh g3@192.168.50.1 'mkdir -p ~/edge-infra'
scp -r infra/edge/. g3@192.168.50.1:~/edge-infra/
scp devices/edge-agent/dist/g3-edge-agent g3@192.168.50.1:~/edge-infra/g3-edge-agent
ssh -t g3@192.168.50.1 'cd ~/edge-infra && sudo ./install-agent.sh ./g3-edge-agent 0.5.0'
```

Use the version in `devices/edge-agent/package.json` as the install label. Reusing a label replaces that version's binary; use a unique suffix such as `-<short-git-commit>` when the old binary must remain available for rollback.

Then verify the deployment from PowerShell:

```powershell
ssh g3@192.168.50.1 'systemctl is-active g3-edge-agent && curl -fsS http://127.0.0.1:8700/health && echo && readlink -f /opt/g3-edge/current'
```

`scp` replaces `rsync` on Windows. It copies the whole `infra/edge` folder, including any local files; do not apply network configuration files unless you are following the separate network-config steps above. SSH and `sudo` can each ask for the Orange Pi password. Enter it only in your terminal. A failed login means the transfer or install has not happened.

After confirming the new agent is healthy, the legacy collector can be removed with the commands in [Removing the old collector](#removing-the-old-collector). Do not remove `/var/lib/g3-edge`: it contains the current agent database and buffered usage.

## Removing the old collector

`install-agent.sh` disables `g3-usage.timer` if it's enabled. The agent replaces it, so the old files can be removed:

```bash
sudo rm -f /etc/systemd/system/g3-usage.{service,timer} /usr/local/bin/g3-usage.py
sudo rm -rf /var/lib/g3-router
sudo systemctl daemon-reload
```

## Checking on the agent

```bash
systemctl status g3-edge-agent
journalctl -u g3-edge-agent -f
curl -s http://127.0.0.1:8700/health     # last collect/push, site tracking, unsent buckets
```

If the hotspot is down, usage is buffered in `/var/lib/g3-edge/agent.db` and uploaded when the connection returns.

**Data budget check:** after a day, compare the "Edge box & overhead" line on the Overview page with total usage. It's WAN traffic not attributed to any LAN client (the box's own usage) and should stay small.

**Site stats accuracy:** a large "(unknown)" share on the Sites page means devices are resolving names without the box's DNS, for example with DNS-over-HTTPS, iCloud Private Relay, or a VPN. Turning on **DNS hardening** (Network → Controls) addresses most of this; VPNs can't be fully stopped.

## Fresh Armbian install (outline)

1. Flash Armbian, create the `g3` user, and set the timezone to `America/New_York`.
2. Disable NetworkManager and use `systemd-networkd`. Install `etc/netplan/10-router.yaml`, `etc/systemd/network/10-wan0.link`, and `etc/systemd/network/20-wan0.network` (all from `local/`, with real MACs), plus `etc/sysctl.d/99-router.conf`. Then run `sudo netplan apply && sudo sysctl --system`, and reboot so the `.link` file names `wan0`.
3. Install `nftables` and `dnsmasq`, and enable both services.
4. Follow "First deployment" steps 6–11, then "Printing rollout" steps 1–7, "Shop drive", and "Phase 2 rollout" steps 5–8.
