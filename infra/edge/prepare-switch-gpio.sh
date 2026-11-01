#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Configure Orange Pi 5 GPIO2_D4 (physical pin 22, wPi 13, Linux GPIO 92)
# as a pulled-up input and expose its value to the unprivileged edge agent.
set -euo pipefail

GPIO_TOOL=$(command -v gpio || true)
if [[ -z $GPIO_TOOL ]]; then
  echo "wiringOP's gpio command is required for the door microswitch." >&2
  exit 1
fi

"$GPIO_TOOL" mode 13 in
"$GPIO_TOOL" mode 13 up

if [[ ! -e /sys/class/gpio/gpio92/value ]]; then
  echo 92 > /sys/class/gpio/export
fi
for _ in {1..20}; do
  [[ -e /sys/class/gpio/gpio92/value ]] && break
  sleep 0.05
done
if [[ ! -e /sys/class/gpio/gpio92/value ]]; then
  echo "GPIO 92 did not appear under /sys/class/gpio." >&2
  exit 1
fi
echo in > /sys/class/gpio/gpio92/direction
chown g3-edge:g3-edge /sys/class/gpio/gpio92/value
chmod 640 /sys/class/gpio/gpio92/value
