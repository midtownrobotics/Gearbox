#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Validates the base network configs before applying them. Copy the whole
# infra/edge/ folder to the box (including local/), then run it from there:
#   rsync -a infra/edge/ g3@192.168.50.1:~/edge-infra/
#   ssh g3@192.168.50.1 'cd ~/edge-infra && sudo ./check.sh'
# Uses the real files in local/ (gitignored) when present, otherwise the
# committed copies (which have placeholder MACs).
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
pick() { if [[ -f "$HERE/local/$1" ]]; then echo "$HERE/local/$1"; else echo "$HERE/$1"; fi; }

NFT=$(pick etc/nftables.conf)
DNSMASQ=$(pick etc/dnsmasq.d/lan.conf)
NETPLAN=$(pick etc/netplan/10-router.yaml)

missing=0
for f in "$NFT" "$DNSMASQ" "$NETPLAN"; do
  if [[ ! -f $f ]]; then echo "Missing: $f" >&2; missing=1; fi
done
if [[ $missing -eq 1 ]]; then
  echo "Run this from a full copy of infra/edge/ (see the top of this script)." >&2
  exit 1
fi

status=0
run() {
  local name=$1
  shift
  echo "== $name"
  if "$@"; then echo "ok"; else echo "FAILED" >&2; status=1; fi
}

run "nftables: $NFT" nft -c -f "$NFT"
run "dnsmasq: $DNSMASQ" dnsmasq --test --conf-file="$DNSMASQ"

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
install -D -m 600 "$NETPLAN" "$ROOT/etc/netplan/10-router.yaml"
run "netplan: $NETPLAN" netplan generate --root-dir "$ROOT"

echo
if [[ $status -eq 0 ]]; then echo "All checks passed."; else echo "Some checks FAILED." >&2; fi
exit $status
