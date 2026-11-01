#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Creates the shop drive: a 10 GB filesystem image mounted at /srv/g3-drive,
# served by the agent at http://drive.local. Being its own filesystem, a full
# drive can never fill the box's main disk. Safe to re-run. On the box:
#   sudo ./setup-drive.sh
# Run install-agent.sh first (it creates the g3-edge user that owns the drive).
set -euo pipefail

IMG=/var/lib/g3-drive.img
MNT=/srv/g3-drive
SIZE=10G

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo)." >&2; exit 1; fi
if ! id g3-edge &>/dev/null; then echo "Run install-agent.sh first (no g3-edge user)." >&2; exit 1; fi

if [[ ! -f $IMG ]]; then
  fallocate -l "$SIZE" "$IMG"
  # -m 0: no space reserved for root; the whole 10 GB is for files.
  mkfs.ext4 -q -m 0 -L g3drive "$IMG"
  echo "Created $SIZE drive image at $IMG"
fi

mkdir -p "$MNT"
if ! grep -q "^$IMG " /etc/fstab; then
  # nofail: the box still boots (and routes) if the image can't be mounted.
  echo "$IMG $MNT ext4 loop,noatime,nofail 0 2" >> /etc/fstab
  systemctl daemon-reload
  echo "Added $MNT to /etc/fstab"
fi
mountpoint -q "$MNT" || mount "$MNT"
chown g3-edge:g3-edge "$MNT"
chmod 0755 "$MNT"

# Announce drive.local over mDNS (how most devices resolve .local names).
HERE=$(cd "$(dirname "$0")" && pwd)
if ! command -v avahi-publish >/dev/null; then
  apt-get install -y avahi-utils
fi
install -m 644 "$HERE/etc/systemd/system/g3-drive-mdns.service" /etc/systemd/system/g3-drive-mdns.service
systemctl daemon-reload
systemctl enable --now g3-drive-mdns.service

df -h "$MNT"
echo "Restarting the agent so it picks up the drive..."
systemctl restart g3-edge-agent
