import { tones } from "@g3/ui";
import { useEffect, useState } from "react";
import type { BatteryState } from "./getters/types";

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

export function formatElapsed(sinceMs: number): string {
  const ms = Date.now() - sinceMs;
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** How long ago `sinceMs` was, counting up. */
export function ElapsedTime({ sinceMs }: { sinceMs: number }) {
  const [text, setText] = useState(() => formatElapsed(sinceMs));
  useEffect(() => {
    const interval = setInterval(() => setText(formatElapsed(sinceMs)), 250);
    return () => clearInterval(interval);
  }, [sinceMs]);
  return <>{text}</>;
}
