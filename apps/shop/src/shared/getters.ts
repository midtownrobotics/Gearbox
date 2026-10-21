import { api } from "./api";
import { getErrorMessage } from "./api-error";
import type {
  Action,
  Batch,
  Blueprint,
  DuplicatePlan,
  KioskPresence,
  OnshapePartLink,
  OnshapeRelease,
  PartDefinition,
  PartFile,
  PartInstance,
  PartInstanceProcess,
  Process,
  QualityAnswer,
  QualityReport,
  QualitySuspect,
  Standing,
  Subsystem,
} from "./types";

export async function fetchSubsystems(): Promise<Subsystem[]> {
  const res = await api.subsystems.$get();
  if (!res.ok) throw new Error(`Failed to fetch subsystems (${res.status})`);
  return res.json() as Promise<Subsystem[]>;
}

export async function fetchProcesses(): Promise<Process[]> {
  const res = await api.processes.$get();
  if (!res.ok) throw new Error(`Failed to fetch processes (${res.status})`);
  return res.json() as Promise<Process[]>;
}

export async function fetchPartDefinitions(): Promise<PartDefinition[]> {
  const res = await api["part-definitions"].$get();
  if (!res.ok) throw new Error(`Failed to fetch parts (${res.status})`);
  return res.json() as Promise<PartDefinition[]>;
}

export async function fetchBlueprint(partDefinitionId: number | string): Promise<Blueprint[]> {
  const res = await api["part-definitions"][":id"].processes.$get({
    param: { id: String(partDefinitionId) },
  });
  if (!res.ok) throw new Error(`Failed to fetch blueprint (${res.status})`);
  return res.json() as Promise<Blueprint[]>;
}

export async function fetchInstances(partDefinitionId: number | string): Promise<PartInstance[]> {
  const res = await api["part-instances"].$get({
    query: { partDefinitionId: String(partDefinitionId) },
  });
  if (!res.ok) throw new Error(`Failed to fetch instances (${res.status})`);
  return res.json() as Promise<PartInstance[]>;
}

export async function fetchAllInstances(): Promise<PartInstance[]> {
  const res = await api["part-instances"].$get({ query: {} });
  if (!res.ok) throw new Error(`Failed to fetch instances (${res.status})`);
  return res.json() as Promise<PartInstance[]>;
}

export async function fetchInstanceProcesses(
  partInstanceId: number | string,
): Promise<PartInstanceProcess[]> {
  const res = await api["part-instance-processes"].$get({
    query: { partInstanceId: String(partInstanceId) },
  });
  if (!res.ok) throw new Error(`Failed to fetch instance processes (${res.status})`);
  return res.json() as Promise<PartInstanceProcess[]>;
}

export async function fetchProcessQueue(
  processId: number | string,
): Promise<PartInstanceProcess[]> {
  const res = await api["part-instance-processes"].$get({
    query: { processId: String(processId) },
  });
  if (!res.ok) throw new Error(`Failed to fetch process queue (${res.status})`);
  return res.json() as Promise<PartInstanceProcess[]>;
}

/** Newest-first audit log of part status changes. */
export async function fetchActions(): Promise<Action[]> {
  const res = await api.actions.$get();
  if (!res.ok) throw new Error(`Failed to fetch actions (${res.status})`);
  return res.json() as Promise<Action[]>;
}

/** Everyone's steps completed and points, for the Leaderboard. */
export async function fetchLeaderboard(): Promise<Standing[]> {
  const res = await api.leaderboard.$get();
  if (!res.ok) throw new Error(`Failed to fetch leaderboard (${res.status})`);
  return (await res.json()).standings;
}

/** Who is logged in at which kiosk device right now. */
export async function fetchKioskPresence(): Promise<KioskPresence[]> {
  const res = await api["kiosk-presence"].$get();
  if (!res.ok) throw new Error(`Failed to fetch kiosk presence (${res.status})`);
  return res.json() as Promise<KioskPresence[]>;
}

/** Resolve a batch of user IDs to display names. */
export async function fetchUserNames(
  ids: string[],
): Promise<{ id: string; displayName: string }[]> {
  if (ids.length === 0) return [];
  const res = await api.users.$get({ query: { ids: ids.join(",") } });
  if (!res.ok) throw new Error(`Failed to fetch user names (${res.status})`);
  return res.json() as Promise<{ id: string; displayName: string }[]>;
}

/** The API only exposes instance processes per-process or per-instance, so
 * fan out across processes (few) rather than instances (many). */
export async function fetchAllInstanceProcesses(
  processes: Process[],
): Promise<PartInstanceProcess[]> {
  const lists = await Promise.all(processes.map((p) => fetchProcessQueue(p.id)));
  return lists.flat();
}

/** URL of the released drawing PDF for a part revision, served from R2 by the shop worker. */
export function drawingUrl(partNumber: string, revision: string): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  return `${base}/parts/${encodeURIComponent(partNumber)}/${encodeURIComponent(revision)}/drawing`;
}

/**
 * Fetches the drawing PDF as an object URL, or null when R2 has no drawing for this revision.
 *
 * The PDF is downloaded once and handed to the viewer as a blob rather than pointing an
 * <iframe> straight at the endpoint: a miss returns JSON, which the browser's PDF viewer
 * would render as a broken document instead of letting us fall back cleanly.
 * Callers must revoke the returned URL when done.
 */
export async function fetchDrawingObjectUrl(
  partNumber: string,
  revision: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch(drawingUrl(partNumber, revision), {
    credentials: "include",
    signal,
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.includes("pdf")) return null;
  return URL.createObjectURL(blob);
}

/**
 * Where the team's released parts are in Onshape, newest release first. Empty when the team has
 * no Onshape document, so a page that links to it shows plain names instead.
 */
export async function fetchOnshapeLinks(): Promise<OnshapePartLink[]> {
  const res = await api.onshape.links.$get();
  if (!res.ok) throw new Error(`Failed to fetch Onshape links (${res.status})`);
  return ((await res.json()) as { links: OnshapePartLink[] }).links;
}

/** The team's Onshape releases with their parts, newest first. */
export async function fetchOnshapeReleases(): Promise<OnshapeRelease[]> {
  const res = await api.onshape.releases.$get();
  if (!res.ok) throw new Error(`Failed to fetch Onshape releases (${res.status})`);
  return ((await res.json()) as { releases: OnshapeRelease[] }).releases;
}

/** Every file in the library, newest first. */
export async function fetchPartFiles(): Promise<PartFile[]> {
  const res = await api["part-files"].$get();
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<PartFile[]>;
}

/** Multipart upload into the library; the typed client can't build FormData bodies here. */
export async function uploadPartFile(file: File): Promise<PartFile> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/part-files`, {
    method: "POST",
    body,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json() as Promise<PartFile>;
}

/** Deletes the file; a batch that had it has no file. */
export async function deletePartFile(id: number): Promise<void> {
  const res = await api["part-files"][":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

export function partFileDownloadUrl(id: number): string {
  return `${import.meta.env.VITE_API_BASE_URL ?? ""}/part-files/${id}/download`;
}

/** Every batch, oldest first, with its file and instances. */
export async function fetchBatches(): Promise<Batch[]> {
  const res = await api["staging-batches"].$get();
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<Batch[]>;
}

/**
 * A new batch at a File Producer process: empty, or with a file, or holding these instances.
 * `refused` says why any of them didn't go in; when none did, nothing is made and this throws.
 */
export async function createBatch(batch: {
  processId: number;
  name?: string | null;
  fileId?: number | null;
  partInstanceIds?: number[];
}): Promise<{ batch: Batch; refused: string[] }> {
  const res = await api["staging-batches"].$post({
    json: {
      processId: batch.processId,
      name: batch.name ?? null,
      fileId: batch.fileId ?? null,
      partInstanceIds: batch.partInstanceIds ?? [],
    },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<{ batch: Batch; refused: string[] }>;
}

/** Names a batch; null or empty gives it back its automatic name. */
export async function renameBatch(id: number, name: string | null): Promise<void> {
  const res = await api["staging-batches"][":id"].$patch({
    param: { id: String(id) },
    json: { name },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/**
 * Adds instances to a batch; they take on its status. Resolves to why any were left out, and
 * throws when none went in.
 */
export async function stageIntoBatch(id: number, partInstanceIds: number[]): Promise<string[]> {
  const res = await api["staging-batches"][":id"].stage.$post({
    param: { id: String(id) },
    json: { partInstanceIds },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return ((await res.json()) as { refused: string[] }).refused;
}

/** Takes instances out of a batch that's still being prepared, back to To Do. */
export async function unstageFromBatch(id: number, partInstanceIds: number[]): Promise<void> {
  const res = await api["staging-batches"][":id"].unstage.$post({
    param: { id: String(id) },
    json: { partInstanceIds },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Sets (or clears, with null) a batch's file. */
export async function setBatchFile(id: number, fileId: number | null): Promise<void> {
  const res = await api["staging-batches"][":id"].file.$put({
    param: { id: String(id) },
    json: { fileId },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Starts or completes a batch, as one, at its File Producer or File Consumer process. */
export async function moveBatch(
  id: number,
  at: "producer" | "consumer",
  to: "doing" | "done",
): Promise<void> {
  const res = await api["staging-batches"][":id"].status.$post({
    param: { id: String(id) },
    json: { at, to },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Sends a whole batch back to To Do at one of its two processes. */
export async function sendBatchBack(id: number, to: "producer" | "consumer"): Promise<void> {
  const res = await api["staging-batches"][":id"]["send-back"].$post({
    param: { id: String(id) },
    json: { to },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Sends one instance back to be made again; its batch keeps a record of it. */
export async function sendInstanceBack(id: number, partInstanceId: number): Promise<void> {
  const res = await api["staging-batches"][":id"].instances[":instanceId"]["send-back"].$post({
    param: { id: String(id), instanceId: String(partInstanceId) },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

export async function fetchDuplicatePlan(id: number): Promise<DuplicatePlan> {
  const res = await api["staging-batches"][":id"].duplicate.$get({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<DuplicatePlan>;
}

/** Copies a batch. When there aren't the parts for it any more, resolves to the plan instead. */
export async function duplicateBatch(id: number): Promise<{ batch: Batch } | DuplicatePlan> {
  const res = await api["staging-batches"][":id"].duplicate.$post({ param: { id: String(id) } });
  if (res.ok) return res.json() as Promise<{ batch: Batch }>;
  const body = (await (res as unknown as Response)
    .clone()
    .json()
    .catch(() => null)) as { plan?: DuplicatePlan } | null;
  if (body?.plan) return body.plan;
  throw new Error(await getErrorMessage(res as unknown as Response));
}

export async function deleteBatch(id: number): Promise<void> {
  const res = await api["staging-batches"][":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Deletes the released drawing PDF for a part revision. */
export async function deleteDrawing(partNumber: string, revision: string): Promise<void> {
  const res = await api.drawings[":partNumber"][":revision"].$delete({
    param: { partNumber, revision },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/**
 * Moves many instances' step at a process: "doing" starts To Do ones, "done" completes
 * In Progress ones (unlocking each next step). Resolves to how many actually moved.
 */
export async function bulkMoveInstances(
  processId: number,
  partInstanceIds: number[],
  to: "doing" | "done",
): Promise<number> {
  const res = await api["part-instance-processes"].bulk.$post({
    json: { processId, partInstanceIds, to },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return ((await res.json()) as { moved: number }).moved;
}

/** Every quality report the team has, newest first (admins only). */
export async function fetchQualityReports(): Promise<QualityReport[]> {
  const res = await api["quality-reports"].$get();
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<QualityReport[]>;
}

/**
 * Files a quality report on a part waiting at a Quality Control step. Passing finishes the step.
 * Also gives back every step before it, with who last finished each and when.
 */
export async function submitQualityReport(input: {
  partInstanceId: number;
  processId: number;
  checks: QualityAnswer[];
  suspectProcessIds: number[];
  unsure: boolean;
  notes: string;
}): Promise<{ report: QualityReport; history: QualitySuspect[] }> {
  const res = await api["quality-reports"].$post({ json: input });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<{ report: QualityReport; history: QualitySuspect[] }>;
}

/**
 * Sends a failed report's part to one of its steps; every step after it waits again. With a fix
 * note, the note goes onto the part's notes and the report counts as a fix.
 */
export async function sendBackFromReport(
  reportId: number,
  processId: number,
  status: "todo" | "doing",
  fixNote?: string,
): Promise<void> {
  const res = await api["quality-reports"][":id"]["send-back"].$post({
    param: { id: String(reportId) },
    json: { processId, status, fix: Boolean(fixNote), fixNote: fixNote ?? "" },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Obsoletes a failed report's part and adds a new one of the same part, started from the top. */
export async function replaceFromReport(reportId: number): Promise<PartInstance> {
  const res = await api["quality-reports"][":id"].replace.$post({
    param: { id: String(reportId) },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return ((await res.json()) as { replacement: PartInstance }).replacement;
}

/** The team's quality checklist, replaced in this order (admins). */
export async function saveQualityChecklist(checklist: string[]): Promise<string[]> {
  const res = await api.admin.quality.checklist.$put({ json: { checklist } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return ((await res.json()) as { checklist: string[] }).checklist;
}
