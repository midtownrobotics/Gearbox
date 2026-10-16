import { fileStepError } from "@g3/worker-shop/process-rules";
import type { PartDefinition, PartInstance, PartInstanceProcess, Process } from "./types";
import type { ShopData } from "./use-shop-data";

/** A part instance joined with its definition and process pipeline. */
export type InstanceRow = {
  instance: PartInstance;
  definition: PartDefinition;
  /** Pipeline rows sorted by index. */
  procs: PartInstanceProcess[];
  /** First non-done process — what the part is on right now. Null when finished. */
  current: PartInstanceProcess | null;
  state: InstanceState;
};

export type InstanceState = "todo" | "doing" | "waiting" | "complete" | "no-processes";

/** What a step's stored status is called on a page. */
export const STATUS_LABELS = { todo: "To Do", doing: "In Progress", done: "Complete" } as const;

export const STATE_META: Record<InstanceState, { label: string; badge: string }> = {
  todo: { label: "To Do", badge: "bg-inset text-secondary-500 border-secondary-300" },
  doing: { label: "In Progress", badge: "bg-amber-50 text-amber-700 border-amber-300" },
  waiting: { label: "Waiting", badge: "bg-page text-secondary-400 border-secondary-200" },
  complete: { label: "Complete", badge: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  "no-processes": {
    label: "No Processes",
    badge: "bg-page text-secondary-400 border-dashed border-secondary-300",
  },
};

/** Join instances with their definitions and pipelines. Obsolete instances
 * (`isStale` in the API) are excluded unless `includeStale` is set — the parts
 * page's Obsolete table needs them. */
export function buildInstanceRows(
  data: ShopData,
  { includeStale = false }: { includeStale?: boolean } = {},
): InstanceRow[] {
  const defById = new Map(data.definitions.map((d) => [d.id, d]));
  const procsByInstance = new Map<number, PartInstanceProcess[]>();
  for (const p of data.instanceProcesses) {
    const list = procsByInstance.get(p.partInstanceId);
    if (list) list.push(p);
    else procsByInstance.set(p.partInstanceId, [p]);
  }

  const rows: InstanceRow[] = [];
  for (const instance of data.instances) {
    if (instance.isStale && !includeStale) continue;
    const definition = defById.get(instance.partDefinitionId);
    if (!definition) continue;
    if (definition.isObsolete) continue;
    const procs = (procsByInstance.get(instance.id) ?? []).sort((a, b) => a.index - b.index);
    const current = procs.find((p) => p.status !== "done") ?? null;
    const state: InstanceState =
      procs.length === 0
        ? "no-processes"
        : current === null
          ? "complete"
          : (current.status as InstanceState);
    rows.push({ instance, definition, procs, current, state });
  }
  return rows;
}

/**
 * A revision that is no longer made: one marked obsolete, or one whose every instance has been
 * made obsolete.
 */
export function isObsoleteRevision(definition: PartDefinition, instances: PartInstance[]): boolean {
  if (definition.isObsolete) return true;
  const own = instances.filter((i) => i.partDefinitionId === definition.id);
  return own.length > 0 && own.every((i) => i.isStale);
}

export function partLabel(row: InstanceRow): string {
  return `${row.definition.onshapePartNumber} · Rev ${row.definition.revision}`;
}

/**
 * The value stamped as a Code 128 barcode on a released drawing. Must stay in step with
 * `drawingBarcodeValue` in workers/shop/src/lib/barcode.ts, which is what prints the sheet.
 */
export function drawingBarcode(definition: PartDefinition): string {
  return `${definition.onshapePartNumber}-${definition.revision}`;
}

/** A scanned barcode compared loosely: scanners may differ in case or add whitespace. */
function normalizeScan(value: string): string {
  return value.trim().toUpperCase();
}

export type ScanMatch =
  | { kind: "found"; row: InstanceRow }
  | { kind: "not-in-queue"; row: InstanceRow }
  | { kind: "unknown" };

/**
 * Resolves a scanned drawing barcode to the part instance to open.
 *
 * `queue` is what the kiosk is currently showing; `all` is every live instance. A part that
 * exists but sits in another queue is reported separately from one we have never heard of,
 * because those two need very different responses from whoever is holding the paper.
 *
 * A drawing identifies a part and revision, not a single instance, so several instances can
 * match. Prefer the one already in progress, then the first waiting to be started.
 */
export function matchScannedDrawing(
  scanned: string,
  queue: InstanceRow[],
  all: InstanceRow[],
): ScanMatch {
  const target = normalizeScan(scanned);
  const matches = (rows: InstanceRow[]) =>
    rows.filter((r) => normalizeScan(drawingBarcode(r.definition)) === target);

  const pick = (rows: InstanceRow[]) =>
    rows.find((r) => r.state === "doing") ?? rows.find((r) => r.state === "todo") ?? rows[0];

  const inQueue = pick(matches(queue));
  if (inQueue) return { kind: "found", row: inQueue };

  const anywhere = pick(matches(all));
  if (anywhere) return { kind: "not-in-queue", row: anywhere };

  return { kind: "unknown" };
}

// ── Shop floor load + mood ────────────────────────────────────────────────────

export type ProcessLoad = {
  process: Process;
  todo: number;
  doing: number;
  level: "none" | "medium" | "high";
};

export function processLoads(rows: InstanceRow[], processes: Process[]): ProcessLoad[] {
  return processes.map((process) => {
    let todo = 0;
    let doing = 0;
    for (const row of rows) {
      if (row.current?.processId !== process.id) continue;
      if (row.current.status === "todo") todo += 1;
      if (row.current.status === "doing") doing += 1;
    }
    const open = todo + doing;
    return { process, todo, doing, level: open === 0 ? "none" : open >= 5 ? "high" : "medium" };
  });
}

/** Find the process a kiosk device is stationed at, by name (case-insensitive). */
export function matchMachineProcess(
  processes: Process[],
  machineName: string | null | undefined,
): Process | null {
  if (!machineName) return null;
  const wanted = machineName.trim().toLowerCase();
  return processes.find((p) => p.name.trim().toLowerCase() === wanted) ?? null;
}

export type ShopMood = {
  label: string;
  blurb: string;
  tone: "calm" | "steady" | "warn" | "hot";
};

/** A loose read on how the shop is doing, based on what's running vs. piling up. */
export function shopMood(loads: ProcessLoad[]): ShopMood {
  const todo = loads.reduce((n, l) => n + l.todo, 0);
  const doing = loads.reduce((n, l) => n + l.doing, 0);
  const busyProcs = loads.filter((l) => l.doing > 0).length;
  const total = loads.length || 1;

  if (todo === 0 && doing === 0) {
    return {
      label: "Chillin'",
      blurb: "Nothing in the queue. Enjoy it while it lasts.",
      tone: "calm",
    };
  }
  if (doing === 0) {
    if (todo >= 8) {
      return {
        label: "Lazy",
        blurb: `${todo} parts are ready to go and nothing is running. Time to spin up.`,
        tone: "warn",
      };
    }
    return {
      label: "Easygoing",
      blurb: `${todo} part${todo === 1 ? " is" : "s are"} ready, nothing started yet.`,
      tone: "calm",
    };
  }
  if (todo >= 12 && busyProcs >= Math.ceil(total / 2)) {
    return {
      label: "Cooked",
      blurb: `${doing} running and ${todo} still waiting — the shop is slammed.`,
      tone: "hot",
    };
  }
  if (busyProcs >= Math.ceil(total * 0.6) || doing >= 5) {
    return {
      label: "Busy",
      blurb: `${doing} in progress across ${busyProcs} process${busyProcs === 1 ? "" : "es"}, ${todo} up next.`,
      tone: "warn",
    };
  }
  return {
    label: "Cruisin'",
    blurb: `Steady pace — ${doing} in progress, ${todo} ready to start.`,
    tone: "steady",
  };
}

/** Names of the processes in `processIds` that require material + thickness on the part. */
export function partInfoRequiredBy(
  processIds: number[],
  processes: { id: number; name: string; requiresPartInfo: number }[],
): string[] {
  const needed = new Set(processIds);
  return processes.filter((p) => p.requiresPartInfo && needed.has(p.id)).map((p) => p.name);
}

/** The File Producer/Consumer error for a list of process IDs, or null (see fileStepError). */
export function pipelineFileError(
  processIds: number[],
  processes: { id: number; name: string; type: string }[],
): string | null {
  const byId = new Map(processes.map((p) => [p.id, p]));
  return fileStepError(processIds.flatMap((id) => byId.get(id) ?? []));
}

/** "4140 — 0.25\"" style suffix for parts that carry material/thickness. */
export function partInfoLabel(d: { material: string | null; thickness: string | null }): string {
  return [d.material, d.thickness].filter(Boolean).join(" — ");
}
