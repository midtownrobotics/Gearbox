import { api } from "./api";
import { getErrorMessage } from "./api-error";
import type {
  Action,
  Blueprint,
  KioskPresence,
  OnshapePartLink,
  PartDefinition,
  PartFile,
  PartInstance,
  PartInstanceProcess,
  Process,
  QualityCheckKey,
  QualityReport,
  QualitySuspect,
  StagingBatch,
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

/** Every file, or only files covering some instance of one part definition. */
export async function fetchPartFiles(partDefinitionId?: number): Promise<PartFile[]> {
  const res = await api["part-files"].$get({
    query: partDefinitionId === undefined ? {} : { partDefinitionId: String(partDefinitionId) },
  });
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

/** Deletes the file and unassigns every instance it covered. */
export async function deletePartFile(id: number): Promise<void> {
  const res = await api["part-files"][":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/**
 * Sets how many instances of a part this file covers. Growing only takes instances that have
 * no file yet, so `assigned` can come back lower than `requested`.
 */
export async function setFileAssignmentCount(
  id: number,
  partDefinitionId: number,
  count: number,
): Promise<{ requested: number; assigned: number }> {
  const res = await api["part-files"][":id"].assignments.$put({
    param: { id: String(id) },
    json: { partDefinitionId, count },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  const body = (await res.json()) as { requested: number; assigned: number };
  return { requested: body.requested, assigned: body.assigned };
}

export async function unassignFileInstance(id: number, partInstanceId: number): Promise<void> {
  const res = await api["part-files"][":id"].assignments[":instanceId"].$delete({
    param: { id: String(id), instanceId: String(partInstanceId) },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

export function partFileDownloadUrl(id: number): string {
  return `${import.meta.env.VITE_API_BASE_URL ?? ""}/part-files/${id}/download`;
}

export async function fetchStagingBatches(processId: number): Promise<StagingBatch[]> {
  const res = await api["staging-batches"].$get({ query: { processId: String(processId) } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<StagingBatch[]>;
}

export async function createStagingBatch(processId: number): Promise<number> {
  const res = await api["staging-batches"].$post({ json: { processId } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return ((await res.json()) as { id: number }).id;
}

/** Stages instances into a batch; they pick up the batch's file. */
export async function stageIntoBatch(id: number, partInstanceIds: number[]): Promise<void> {
  const res = await api["staging-batches"][":id"].stage.$post({
    param: { id: String(id) },
    json: { partInstanceIds },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Sends instances back to To Do; they lose the batch's file. */
export async function unstageFromBatch(id: number, partInstanceIds: number[]): Promise<void> {
  const res = await api["staging-batches"][":id"].unstage.$post({
    param: { id: String(id) },
    json: { partInstanceIds },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

/** Sets (or clears, with null) a batch's file on every instance staged in it. */
export async function setStagingBatchFile(id: number, fileId: number | null): Promise<void> {
  const res = await api["staging-batches"][":id"].file.$put({
    param: { id: String(id) },
    json: { fileId },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

export async function completeStagingBatch(id: number): Promise<void> {
  const res = await api["staging-batches"][":id"].complete.$post({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}

export async function deleteStagingBatch(id: number): Promise<void> {
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
  checks: Record<QualityCheckKey, boolean>;
  suspectProcessIds: number[];
  unsure: boolean;
  notes: string;
}): Promise<{ report: QualityReport; history: QualitySuspect[] }> {
  const res = await api["quality-reports"].$post({ json: input });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
  return res.json() as Promise<{ report: QualityReport; history: QualitySuspect[] }>;
}

/** Sends a failed report's part back to an earlier step; every step after it waits again. */
export async function sendBackFromReport(
  reportId: number,
  processId: number,
  status: "todo" | "doing",
): Promise<void> {
  const res = await api["quality-reports"][":id"]["send-back"].$post({
    param: { id: String(reportId) },
    json: { processId, status },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
}
