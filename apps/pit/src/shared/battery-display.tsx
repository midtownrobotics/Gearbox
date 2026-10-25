import { tones } from "@g3/ui";
import { useEffect, useState } from "react";
import type { Battery, BatteryState } from "./getters/types";

// How a battery is shown wherever one is: its state's color, its voltage's, and how long it has
// been in its state.

/**
 * Fixed colors because they mean something, the same as a status anywhere else: green for the one
 * that's ready, amber for one that's waiting, blue for one in use, red for a problem.
 */
export const STATE_TONES: Record<BatteryState, string> = {
  "Next Up": tones.success,
  Charging: tones.warning,
  "In Robot": tones.info,
  Idle: tones.neutral,
  Broken: tones.danger,
};

/** Green for a charged battery, amber for one getting low, red for one that shouldn't go in. */
export function voltageColor(volts: number): string {
  if (volts >= 12.5) return "text-emerald-700";
  if (volts >= 12.0) return "text-amber-700";
  return "text-red-700";
}

/**
 * How long a battery's timer has counted at `now`, in ms: the time in its state while the team's
 * timers ran. A battery from before timers could pause (an offline copy) counts from its state.
 */
export function timerMs(
  battery: Pick<Battery, "stateSince" | "countedMs" | "countingSince">,
  now = Date.now(),
): number {
  const since = battery.countingSince === undefined ? battery.stateSince : battery.countingSince;
  return (battery.countedMs ?? 0) + (since === null ? 0 : Math.max(0, now - since));
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** How long a battery has been in its state, counting up while its timer runs. */
export function ElapsedTime({ battery }: { battery: Battery }) {
  const { stateSince, countedMs, countingSince } = battery;
  const read = () => formatDuration(timerMs({ stateSince, countedMs, countingSince }));
  const [text, setText] = useState(read);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read uses only these
  useEffect(() => {
    setText(read());
    if (countingSince === null) return;
    const interval = setInterval(() => setText(read()), 250);
    return () => clearInterval(interval);
  }, [stateSince, countedMs, countingSince]);
  return (
    <>
      {text}
      {countingSince === null && " (paused)"}
    </>
  );
}
