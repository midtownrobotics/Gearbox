import { useEffect, useSyncExternalStore } from "react";
import {
  fetchAllInstanceProcesses,
  fetchAllInstances,
  fetchBatches,
  fetchPartDefinitions,
  fetchProcesses,
  fetchSubsystems,
} from "./getters";
import type {
  Batch,
  PartDefinition,
  PartInstance,
  PartInstanceProcess,
  Process,
  Subsystem,
} from "./types";

export type ShopData = {
  subsystems: Subsystem[];
  processes: Process[];
  definitions: PartDefinition[];
  instances: PartInstance[];
  instanceProcesses: PartInstanceProcess[];
  batches: Batch[];
};

type State = { data: ShopData | null; loading: boolean; error: string | null };

// One copy for the whole page, so the bar, the page under it and a view opened over it (a part,
// a batch) all show the same thing, and a change made in one shows in the others.
let state: State = { data: null, loading: true, error: null };
const listeners = new Set<() => void>();
let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

async function load() {
  try {
    const [subsystems, processes, definitions, instances, batches] = await Promise.all([
      fetchSubsystems(),
      fetchProcesses(),
      fetchPartDefinitions(),
      fetchAllInstances(),
      fetchBatches(),
    ]);
    const instanceProcesses = await fetchAllInstanceProcesses(processes);
    set({
      data: { subsystems, processes, definitions, instances, instanceProcesses, batches },
      loading: false,
      error: null,
    });
  } catch (e) {
    set({
      ...state,
      loading: false,
      error: e instanceof Error ? e.message : "Failed to load shop data.",
    });
  }
}

/** Loads the shop's data again, for everything on the page that shows it. */
export function refreshShopData(): Promise<void> {
  if (!running) {
    running = load().finally(() => {
      running = null;
    });
    return running;
  }
  // One is under way and may have read what has since changed: go again once it's done.
  queued ??= running.then(() => {
    queued = null;
    return refreshShopData();
  });
  return queued;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useShopData() {
  const current = useSyncExternalStore(subscribe, () => state);

  // Fresh data whenever a page opens; what was last loaded shows until it arrives.
  useEffect(() => {
    if (!running) refreshShopData();
  }, []);

  return { ...current, refresh: refreshShopData };
}
