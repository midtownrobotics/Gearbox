#!/usr/bin/env bash
# Installs or upgrades the edge agent on the edge box. Run as root on the box:
#   sudo ./install-agent.sh ./g3-edge-agent 0.1.0
# Expects to be run from a copy of infra/edge/ (it reads files from etc/).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo)." >&2; exit 1; fi
if [[ $# -ne 2 ]]; then echo "Usage: $0 <path-to-g3-edge-agent-binary> <version>" >&2; exit 1; fi

BINARY=$1
VERSION=$2
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=/opt/g3-edge

# Refuse to install from a damaged copy: an empty unit, script or config file would quietly
# break the box at its next boot (an empty unit reads as masked; an empty tmpfiles.d entry
# leaves dnsmasq without its log folder, so no DHCP or DNS).
empty=$(find "$HERE" -type f -empty ! -path "*/.git/*")
if [[ -n $empty ]]; then
  echo "These files are empty; copy infra/edge to the box again:" >&2
  echo "$empty" >&2
  exit 1
fi
if [[ ! -s $BINARY ]]; then echo "$BINARY is empty or missing." >&2; exit 1; fi

# 1. Service user (no login, no home).
if ! id g3-edge &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin g3-edge
  echo "Created user g3-edge"
fi
# The print module manages CUPS printers and sees all jobs, which needs lpadmin.
if getent group lpadmin >/dev/null; then
  usermod -aG lpadmin g3-edge
else
  echo "Warning: no lpadmin group (is CUPS installed?); printing won't work." >&2
fi
# The door-switch module uses aplay to write to the Orange Pi's audio device.
if getent group audio >/dev/null; then
  usermod -aG audio g3-edge
else
  echo "Warning: no audio group; door-open sounds may not play." >&2
fi
install -d -m 755 -o g3-edge -g g3-edge /srv/g3-sounds
if ! command -v gpio >/dev/null; then
  echo "wiringOP's gpio command is required for GPIO2_D4. Install wiringOP, then retry." >&2
  exit 1
fi
if ! command -v aplay >/dev/null; then
  echo "aplay is required for door sounds. Install it with: apt install alsa-utils" >&2
  exit 1
fi

# 2. Binary: /opt/g3-edge/versions/<version>/g3-edge-agent, with `current` pointing at it.
install -d -m 755 "$BASE/versions/$VERSION"
install -m 755 "$BINARY" "$BASE/versions/$VERSION/g3-edge-agent"
ln -sfn "versions/$VERSION" "$BASE/current.tmp"
mv -T "$BASE/current.tmp" "$BASE/current"
echo "Installed $VERSION -> $BASE/current"

# 3. Config. Stop here on first install so the key can be filled in.
install -d -m 755 /etc/g3-edge
if [[ ! -f /etc/g3-edge/agent.env ]]; then
  install -m 600 -o root -g root "$HERE/etc/g3-edge/agent.env.example" /etc/g3-edge/agent.env
  echo
  echo "Created /etc/g3-edge/agent.env from the example."
  echo "Set EDGE_AGENT_KEY (and EDGE_WORKER_URL if needed), then re-run this script."
  exit 0
fi
if grep -q '^EDGE_AGENT_KEY=replace-me' /etc/g3-edge/agent.env; then
  echo "EDGE_AGENT_KEY in /etc/g3-edge/agent.env is still the placeholder." >&2
  exit 1
fi
chmod 600 /etc/g3-edge/agent.env

# 4. The agent reads the dnsmasq leases file; make sure it can.
LEASES=/var/lib/misc/dnsmasq.leases
if [[ -f $LEASES ]] && ! sudo -u g3-edge test -r "$LEASES"; then
  echo "Warning: g3-edge can't read $LEASES; clients will show as ip:<addr>." >&2
fi

# 5. systemd units: the agent, plus the path unit that restarts dnsmasq when
#    the agent changes its generated config (so the agent needs no privileges).
install -d -m 755 /usr/local/lib/g3-edge
install -m 755 "$HERE/prepare-switch-gpio.sh" /usr/local/lib/g3-edge/prepare-switch-gpio.sh
for unit in g3-edge-agent.service g3-edge-dnsmasq.path g3-edge-dnsmasq.service g3-door-gpio.service; do
  install -m 644 "$HERE/etc/systemd/system/$unit" "/etc/systemd/system/$unit"
done
install -m 644 "$HERE/etc/tmpfiles.d/g3-edge.conf" /etc/tmpfiles.d/g3-edge.conf
systemd-tmpfiles --create /etc/tmpfiles.d/g3-edge.conf
# dnsmasq makes its own query log folder on every start too, so DHCP and DNS never depend on
# the tmpfiles.d entry above.
install -d -m 755 /etc/systemd/system/dnsmasq.service.d
install -m 644 "$HERE/etc/systemd/system/dnsmasq.service.d/g3-edge.conf" \
  /etc/systemd/system/dnsmasq.service.d/g3-edge.conf
# Everything above is on disk before anything restarts: a power cut right after an install
# must not leave empty files behind.
sync
systemctl daemon-reload
systemctl enable --now g3-edge-dnsmasq.path

# 6. Retire the old collector (script and its database are left in place).
if systemctl list-unit-files g3-usage.timer &>/dev/null && systemctl is-enabled g3-usage.timer &>/dev/null; then
  systemctl disable --now g3-usage.timer
  echo "Disabled old g3-usage.timer"
fi

systemctl enable g3-edge-agent
systemctl enable g3-door-gpio.service
systemctl restart g3-door-gpio.service
systemctl restart g3-edge-agent
sync
sleep 2
systemctl --no-pager --lines=10 status g3-edge-agent || true
echo
echo "Health: $(curl -fsS http://127.0.0.1:8700/health || echo 'not responding yet')"
