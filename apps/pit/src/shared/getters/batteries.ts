import { api } from "../api";
import type { Battery, BatteryTimers } from "./types";

export async function fetchBatteries(): Promise<Battery[]> {
  const res = await api.batteries.$get();
  if (!res.ok) throw new Error(`Failed to fetch batteries (${res.status})`);
  return res.json() as Promise<Battery[]>;
}

export async function fetchBatteryTimers(): Promise<BatteryTimers> {
  const res = await api.batteries.timers.$get();
  if (!res.ok) throw new Error(`Failed to fetch battery timers (${res.status})`);
  return res.json() as Promise<BatteryTimers>;
}

/** Pause All or Unpause All. */
export async function setBatteryTimersPaused(paused: boolean): Promise<BatteryTimers> {
  const res = await api.batteries.timers.$post({ json: { paused } });
  if (!res.ok)
    throw new Error(`Failed to ${paused ? "pause" : "unpause"} the timers (${res.status})`);
  return res.json() as Promise<BatteryTimers>;
}
