# Installing the edge agent on the Pi

How to put `g3-edge-agent` on the shop's edge box (Orange Pi 5, Armbian, hostname `orangepi5`, login user `g3`) from Ubuntu, macOS or Windows. The design is in [docs/edge.md](../../docs/edge.md).

**Everything here is applied by hand over SSH. The agent never applies any of it.** A bad netplan or nftables change can cut the box off from the internet, and then it can't receive a fix.

On the shop LAN the box is always at `192.168.50.1`:

```bash
ssh g3@192.168.50.1
```

## What's in this folder

Files under `etc/` mirror where they go on the box. `local/` is **gitignored** and holds the box's real files (this repo is public, so the committed `etc/netplan/10-router.yaml` has placeholder MACs). `check.sh` uses the `local/` copy of a file when there is one.

| Path | Purpose |
|---|---|
| `install-agent.sh` | Installs or upgrades the agent binary (keeps old versions for rollback) |
| `check.sh` | Validates nftables, dnsmasq and netplan configs before you apply them |
| `setup-drive.sh` | Creates and mounts the 10 GB shop drive (one-time) |
| `etc/g3-edge/agent.env.example` | Template for `/etc/g3-edge/agent.env` (config and shared key; root-only) |
| `etc/systemd/system/*` | The agent's unit (user `g3-edge`, only `CAP_NET_ADMIN` and `CAP_NET_BIND_SERVICE`), the dnsmasq restart units, door GPIO setup, `drive.local` mDNS |
| `etc/nftables.conf` | Firewall, NAT and the `inet acct` counters the agent reads |
| `etc/dnsmasq.d/lan.conf` | LAN DHCP/DNS, the query log, the agent's generated config, `drive.local` |
| `etc/netplan/`, `etc/systemd/network/`, `etc/sysctl.d/` | `lan0`/`wan0` naming and addressing, IPv4 forwarding |
| `etc/tmpfiles.d/`, `etc/logrotate.d/` | Directories for the DNS query log and generated config; log rotation |

## On your computer (once)

You need [Bun](https://bun.sh), Node.js (for Corepack/pnpm) and an SSH client, then `pnpm install` in the repo root.

- **Ubuntu:** `curl -fsSL https://bun.sh/install | bash`, Node.js from your package manager or nvm, `sudo apt install openssh-client rsync`.
- **macOS:** `brew install oven-sh/bun/bun node rsync` (ssh is built in).
- **Windows:** install Bun (`powershell -c "irm bun.sh/install.ps1 | iex"`), Node.js, and the OpenSSH client (Settings → Optional features). Open a new PowerShell window afterwards so `bun`, `corepack`, `ssh` and `scp` are on `PATH`. Use `corepack pnpm` wherever this page says `pnpm`.

The build cross-compiles a Linux ARM64 binary (about 80 MB) on any of these, so copy it over the shop LAN, not the hotspot.

## Install or upgrade the agent

Run from the repo root while on the shop LAN. Use the version in `devices/edge-agent/package.json` as `<version>`; reusing a label replaces that version's binary, so add a suffix such as `-<short-commit>` if you want to keep the old one for rollback.

**Ubuntu / macOS:**

```bash
pnpm --filter @g3/edge-agent run build
rsync -a infra/edge/ devices/edge-agent/dist/g3-edge-agent g3@192.168.50.1:~/edge-infra/
ssh -t g3@192.168.50.1 'cd ~/edge-infra && sudo ./install-agent.sh ./g3-edge-agent <version>'
```

**Windows (PowerShell):**

```powershell
corepack pnpm --filter @g3/edge-agent run build
ssh g3@192.168.50.1 'mkdir -p ~/edge-infra'
scp -r infra/edge/. g3@192.168.50.1:~/edge-infra/
scp devices/edge-agent/dist/g3-edge-agent g3@192.168.50.1:~/edge-infra/g3-edge-agent
ssh -t g3@192.168.50.1 'cd ~/edge-infra && sudo ./install-agent.sh ./g3-edge-agent <version>'
```

SSH and `sudo` may each ask for the Pi's password. Copying the folder doesn't change the box's network config; only the steps under "Changing the network config" do.

On the very first install, `install-agent.sh` creates `/etc/g3-edge/agent.env` and stops. Put the team's box key in `EDGE_AGENT_KEY` (`sudo nano /etc/g3-edge/agent.env`; an admin makes it on the Edge app's Edge Box page, where it's shown once) and `EDGE_WORKER_URL` on the team's own Edge address (`https://<number>-edge.frcgearbox.com/api`), and run the same install command again. Set the box's time zone to the shop's (`sudo timedatectl set-timezone America/New_York`, or wherever the shop is): the team's days, billing cycles and "until midnight" exceptions are counted in it.

**Check it** (same command on every OS):

```bash
ssh g3@192.168.50.1 'systemctl is-active g3-edge-agent && curl -fsS http://127.0.0.1:8700/health && echo && readlink -f /opt/g3-edge/current'
```

The health output should show `"link": {"connected": true, ...}`: the box's own connection to the edge worker, which is how printing, part lookups and the live pages reach it. The agent opens it itself (to `EDGE_WORKER_URL`, with `EDGE_AGENT_KEY`) and reconnects whenever it drops, so there's no tunnel or port to set up. After 5 minutes, `network` should show `lastCollectError: null`, `lastSitesError: null` and `presence.lastError: null`. The Edge Box page's **Connection** card shows the same from the app.

## Moving an existing box off the tunnel (once)

Agents before 0.5.0 were reached through a Cloudflare Tunnel (`edge-agent.g3robotics.com`). The edge worker no longer uses it. After deploying the worker and installing the new agent (above), and once the Connection card says **Connected**:

1. On the box, check the agent's worker address is the current one, then remove `cloudflared`:
   ```bash
   ssh -t g3@192.168.50.1 'sudo grep EDGE_WORKER_URL /etc/g3-edge/agent.env'   # https://1648-edge.frcgearbox.com/api
   ssh -t g3@192.168.50.1 'sudo cloudflared service uninstall; sudo apt remove -y cloudflared'
   ```
2. In the Cloudflare dashboard, **Zero Trust → Networks → Tunnels**: delete the box's tunnel (and with it the `edge-agent.g3robotics.com` public hostname). Then check **DNS** for `g3robotics.com` and delete the `edge-agent` CNAME if it's still there.
3. Delete the old worker setting if it's still in the dashboard: the edge worker no longer reads `EDGE_AGENT_URL`.

**Roll back** to a previous version (they're kept in `/opt/g3-edge/versions/`):

```bash
ssh -t g3@192.168.50.1 'sudo ln -sfn versions/<old> /opt/g3-edge/current && sudo systemctl restart g3-edge-agent'
```

## First-time box setup

Only for a new box (or a fresh Armbian install). Do these on the box over SSH, from `~/edge-infra` after copying the folder as above.

1. **Base system.** Flash Armbian, create the `g3` user, set the timezone to `America/New_York`. Disable NetworkManager and use `systemd-networkd`: install `etc/netplan/10-router.yaml`, `etc/systemd/network/10-wan0.link` and `20-wan0.network` (from `local/`, with real MACs) and `etc/sysctl.d/99-router.conf`, run `sudo netplan apply && sudo sysctl --system`, and reboot so `wan0` gets its name.
2. **Packages.**
   ```bash
   sudo apt install nftables dnsmasq cups cups-filters avahi-daemon avahi-utils alsa-utils
   sudo systemctl enable --now nftables dnsmasq cups avahi-daemon
   ```
3. **Install the agent** (above). This creates the `g3-edge` user, which the next steps need.
4. **Validate, then apply the network config:**
   ```bash
   sudo ./check.sh
   sudo cp etc/tmpfiles.d/g3-edge.conf /etc/tmpfiles.d/ && sudo systemd-tmpfiles --create /etc/tmpfiles.d/g3-edge.conf
   sudo cp etc/logrotate.d/g3-edge-dns /etc/logrotate.d/
   sudo cp local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/ && sudo systemctl restart dnsmasq
   sudo cp local/etc/nftables.conf /etc/nftables.conf && sudo nft -f /etc/nftables.conf
   ```
5. **Shop drive:** `sudo ./setup-drive.sh` (makes the 10 GB image at `/srv/g3-drive`, mounts it, starts the `drive.local` announcement). Optionally keep mDNS off the hotspot side: `sudo sed -i 's/^#\?allow-interfaces=.*/allow-interfaces=lan0/' /etc/avahi/avahi-daemon.conf && sudo systemctl restart avahi-daemon g3-drive-mdns`.
6. **Door sounds:** wire the microswitch between physical pin 22 (GPIO2_D4, Linux GPIO 92) and GND (pin 20); never connect it to 5 V. Plug powered speakers into the 3.5 mm jack. If `aplay -l` shows a card other than `rockchipes8388`, set `EDGE_SWITCH_AUDIO_DEVICE` in `agent.env` and restart the agent. Upload sounds in the Edge app under **Edge Box → Door Sounds**. The test button starts playback immediately, and **Stop sound** stops it; one sound plays at a time, so a new test or door opening replaces the one playing. Use Refresh status to see any later playback error. The sound starts after the door opens, repeats while it stays open, and stops as soon as the switch reads closed; a stable close rearms the next opening.
7. **Printer:** in the Edge app, **Print → Printers → Find printers**, then **Add** and **Print test page**.

Remove the `# TEMP` SSH-on-`wan0` rule in `nftables.conf` (both copies) before going live.

## Changing the network config

1. Edit the file in `local/` and make the same change to the committed copy (keeping placeholder MACs).
2. Copy the folder to the box (as in "Install") and run `sudo ./check.sh`.
3. Apply one file at a time:
   - **netplan (`lan0`):** `sudo cp local/etc/netplan/10-router.yaml /etc/netplan/ && sudo netplan try` (rolls back unless you confirm within 120 s).
   - **`wan0` (`.link`, `.network`):** not covered by `netplan try`, so keep a keyboard and HDMI handy. `.network` changes apply with `sudo networkctl reload`, `.link` changes at the next boot.
   - **nftables:** `sudo cp local/etc/nftables.conf /etc/ && sudo nft -f /etc/nftables.conf`
   - **dnsmasq:** `sudo cp local/etc/dnsmasq.d/lan.conf /etc/dnsmasq.d/ && sudo systemctl restart dnsmasq`

The agent relies on: the `inet acct` table with sets `dl`, `ul`, `flows_dl`, `flows_ul` (flows timeout at least 1 hour); interfaces named `wan0` and `lan0`; the query log at `/run/g3-edge-dns/queries.log`, rotated in `create` mode; `nftables.conf` never using `flush ruleset` (it would delete the agent's `inet g3` table); and `lan.conf` keeping its `conf-dir=/var/lib/g3-edge/dnsmasq/,*.conf` line.

## Troubleshooting

```bash
systemctl status g3-edge-agent
journalctl -u g3-edge-agent -f
curl -s http://127.0.0.1:8700/health
```

- **"The edge box isn't connected"** in the app: check `systemctl status g3-edge-agent`, then `"link"` in the health output. `lastError` says why it's down; the agent keeps retrying (up to once a minute).
- **`link.lastError` mentions 401, or the agent never connects:** `EDGE_AGENT_KEY` in `/etc/g3-edge/agent.env` isn't the team's current box key (a new key on the Edge Box page replaces the old one), or `EDGE_WORKER_URL` is another team's address. A 410 means `EDGE_WORKER_URL` is a retired address.
- **Blocking misbehaves:** turn off **Enforce blocklists** and **DNS hardening** in the app. Without the app, `sudo nft delete table inet g3` removes blocking until the agent's next cycle; `sudo systemctl stop g3-edge-agent` keeps it off.
- **Printer "Stopped":** click **Resume** on the Printers page once it's back; `lpstat -p -d` and `sudo journalctl -u cups -n 50` on the box.
- If the hotspot is down, usage is buffered in `/var/lib/g3-edge/agent.db` and uploaded later. Don't delete `/var/lib/g3-edge`.
