import { Badge, Button, ConfirmButton, ErrorBanner, TextField, inputClass } from "@g3/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type FileState,
  batchComplete,
  batchMembers,
  fileState,
  linkFileToPart,
  processNamer,
  stageableRows,
} from "../../shared/batches";
import { type InstanceRow, isObsoleteRevision } from "../../shared/derive";
import { deletePartFile, fetchPartFiles, uploadPartFile } from "../../shared/getters";
import type { Batch, PartDefinition, PartFile, PartInstance } from "../../shared/types";
import { useKiosk } from "../../shared/use-auth";
import { type ShopData, refreshShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";
import { BatchLink, BatchStatusBadge, FileLink, PartNameLink } from "../batches/batch-ui";
import {
  CountInput,
  DownloadLink,
  FileHeading,
  FileMeta,
  MAX_FILE_BYTES,
  NoticeText,
  UploadButton,
  formatBytes,
  formatInstanceRanges,
  partLabelOf,
} from "./file-ui";

/** The file subsections, in the order the page shows them, with what each holds. */
const FILE_STATES: { state: FileState; title: string; empty: string }[] = [
  { state: "not-started", title: "Not Started", empty: "No file is waiting on its batch." },
  { state: "in-progress", title: "In Progress", empty: "No file is in use right now." },
  { state: "complete", title: "Complete", empty: "No file's batches are all complete yet." },
  { state: "unused", title: "Unused", empty: "Every file is in a batch." },
  { state: "obsolete", title: "Obsolete", empty: "No file is obsolete." },
];

/**
 * The file library, by where each file's batches are. A file is used by putting it on a batch;
 * "Start a batch" makes one from a part number here, and the Shop Floor makes them too.
 */
export function PartFilesSection({ data, rows }: { data: ShopData | null; rows: InstanceRow[] }) {
  const kiosk = useKiosk();
  const [files, setFiles] = useState<PartFile[]>([]);
  const [search, setSearch] = useState("");
  const [uploadTarget, setUploadTarget] = useState<PartTarget>(EMPTY_TARGET);
  const [startingFor, setStartingFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const resolveName = useUserNames(files.map((f) => f.uploadedBy));
  const processName = processNamer(data);
  const batches = data?.batches ?? [];

  const load = useCallback(async () => {
    try {
      setFiles(await fetchPartFiles());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load part files.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const definitionById = useMemo(
    () => new Map((data?.definitions ?? []).map((d) => [d.id, d])),
    [data],
  );
  // The batches that have each file and hold parts, newest first.
  const batchesOf = useMemo(() => {
    const map = new Map<number, Batch[]>();
    for (const b of [...batches].reverse()) {
      if (b.fileId === null || batchMembers(b).length === 0) continue;
      map.set(b.fileId, [...(map.get(b.fileId) ?? []), b]);
    }
    return map;
  }, [batches]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.filename.toLowerCase().includes(q) ||
        (batchesOf.get(f.id) ?? []).some(
          (b) =>
            b.label.toLowerCase().includes(q) ||
            b.instances.some((i) => {
              const d = definitionById.get(i.partDefinitionId);
              return (
                !!d &&
                (partLabelOf(d).toLowerCase().includes(q) || d.name?.toLowerCase().includes(q))
              );
            }),
        ),
    );
  }, [files, search, batchesOf, definitionById]);

  async function run(action: () => Promise<string[] | undefined>) {
    setBusy(true);
    setError(null);
    setNotices([]);
    try {
      setNotices((await action()) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      await Promise.all([load(), refreshShopData()]);
      setBusy(false);
    }
  }

  const resolve = (t: PartTarget) =>
    resolvePartTarget(t, data?.definitions ?? [], data?.instances ?? []);
  const waiting = (d: PartDefinition) => (data ? stageableRows(rows, data, d.id).length : 0);

  /** Uploads each file; with a part given, links each to that many of its instances as a batch. */
  function handleUpload(selected: File[]) {
    if (selected.length === 0 || !data) return;
    const blank = !uploadTarget.partNumber.trim();
    const target = blank ? null : resolve(uploadTarget);
    if (target && "error" in target) {
      setError(target.error);
      return;
    }
    const count = Number(uploadTarget.count) || 0;
    run(async () => {
      const notes: string[] = [];
      // Instances one of these batches has taken aren't offered to the next.
      let free = rows;
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over the 100 MB limit.`);
        const uploaded = await uploadPartFile(file);
        if (!target) continue;
        const { batch, notice } = await linkFileToPart(
          free,
          data,
          target.definition,
          count,
          uploaded.id,
        );
        const taken = new Set(batch.instances.map((i) => i.partInstanceId));
        free = free.filter((r) => !taken.has(r.instance.id));
        if (notice) notes.push(`${file.name}: ${notice}`);
      }
      if (!blank) setUploadTarget(EMPTY_TARGET);
      return notes;
    });
  }

  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);
  const searching = search.trim() !== "";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl text-secondary-900">Files</h2>
          <p className="text-xs text-secondary-400">
            {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
          </p>
        </div>
        {!kiosk.active && (
          <div className="flex flex-wrap items-center gap-2">
            <PartTargetFields
              value={uploadTarget}
              onChange={setUploadTarget}
              waiting={waiting}
              definitions={data?.definitions ?? []}
              instances={data?.instances ?? []}
              optionalHint="Leave blank to upload without a batch"
            />
            <UploadButton busy={busy} onFiles={handleUpload} />
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {notices.map((n) => (
        <NoticeText key={n} message={n} />
      ))}

      <TextField
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by file, batch, part number or part name…"
      />

      {files.length === 0 ? (
        <p className="text-secondary-500 text-sm">
          No files yet. Upload one here, or on a batch at a File Producer process on the Shop Floor.
        </p>
      ) : searching && visible.length === 0 ? (
        <p className="text-secondary-500 text-sm">No files match your search.</p>
      ) : (
        FILE_STATES.map(({ state, title, empty }) => {
          const list = visible.filter((f) => fileState(f, batches) === state);
          // A search shows only the subsections that have a match.
          if (searching && list.length === 0) return null;
          return (
            <Subsection key={state} title={title} count={list.length} empty={empty}>
              {list.map((file) => {
                const used = batchesOf.get(file.id) ?? [];
                const live = used.filter((b) => !batchComplete(b));
                return (
                  <li key={file.id} className="px-4 py-3 space-y-2">
                    <FileHeading
                      name={<FileLink file={file} />}
                      title={file.filename}
                      details={<FileMeta file={file} uploader={resolveName(file.uploadedBy)} />}
                    >
                      <DownloadLink file={file} />
                      {!kiosk.active && !file.obsolete && startingFor !== file.id && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => setStartingFor(file.id)}
                        >
                          Start a batch
                        </Button>
                      )}
                      {!kiosk.active && (
                        <ConfirmButton
                          size="sm"
                          label="Delete"
                          question={`${
                            live.length > 0
                              ? `${live.map((b) => b.label).join(", ")} ${live.length === 1 ? "is" : "are"} still in production with it. `
                              : ""
                          }Delete ${file.filename}? ${
                            used.length > 0 ? "Its batches will have no file. " : ""
                          }This can't be undone.`}
                          disabled={busy}
                          onConfirm={() => run(() => deletePartFile(file.id).then(() => undefined))}
                        />
                      )}
                    </FileHeading>

                    {used.length === 0 ? (
                      <p className="text-xs text-secondary-400">
                        {state === "obsolete"
                          ? "Made for a part that's now obsolete."
                          : "Not on a batch with instances in it."}
                      </p>
                    ) : (
                      used.map((batch) => (
                        <FileBatch
                          key={batch.id}
                          batch={batch}
                          definitionById={definitionById}
                          instances={data?.instances ?? []}
                          processName={processName}
                        />
                      ))
                    )}

                    {startingFor === file.id && data && (
                      <StartBatch
                        busy={busy}
                        definitions={data.definitions}
                        instances={data.instances}
                        waiting={waiting}
                        onError={setError}
                        onCancel={() => setStartingFor(null)}
                        onStart={(definition, count) => {
                          setStartingFor(null);
                          run(async () => {
                            const { notice } = await linkFileToPart(
                              rows,
                              data,
                              definition,
                              count,
                              file.id,
                            );
                            return notice ? [notice] : [];
                          });
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </Subsection>
          );
        })
      )}
    </section>
  );
}

/** One of a section's groups: its name and count, then its rows, or what would be in it. */
export function Subsection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
        {title} <span className="text-primary-600">{count}</span>
      </h3>
      {count === 0 ? (
        <p className="text-secondary-400 text-sm">{empty}</p>
      ) : (
        <ul className="bg-surface border border-secondary-200 rounded-lg divide-y divide-secondary-200">
          {children}
        </ul>
      )}
    </div>
  );
}

/** One batch that has the file: its name and status, and the parts in it. */
function FileBatch({
  batch,
  definitionById,
  instances,
  processName,
}: {
  batch: Batch;
  definitionById: Map<number, PartDefinition>;
  instances: PartInstance[];
  processName: (id: number) => string;
}) {
  const members = batchMembers(batch);
  const partIds = [...new Set(members.map((m) => m.partDefinitionId))];
  const stale = new Set(instances.filter((i) => i.isStale).map((i) => i.id));
  return (
    <div className="pl-3 border-l-2 border-secondary-200 space-y-1">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <BatchLink batch={batch} />
        <BatchStatusBadge batch={batch} processName={processName} />
      </p>
      {partIds.map((id) => {
        const d = definitionById.get(id);
        if (!d) return null;
        const mine = members.filter((m) => m.partDefinitionId === id);
        const obsolete = d.isObsolete || mine.some((m) => stale.has(m.partInstanceId));
        return (
          <p key={id} className="flex flex-wrap items-center gap-x-2 text-xs text-secondary-500">
            <PartNameLink definition={d} />
            <span className="font-mono text-secondary-400">{partLabelOf(d)}</span>
            <span className="font-mono">
              {formatInstanceRanges(mine.map((m) => m.instanceNumber))}
            </span>
            {obsolete && <Badge>Obsolete</Badge>}
          </p>
        );
      })}
    </div>
  );
}

type PartTarget = { partNumber: string; count: string };
const EMPTY_TARGET: PartTarget = { partNumber: "", count: "" };

/**
 * The part a typed part number means (case-insensitive): always its most recent revision. A file
 * is never linked to an older one, so there is no revision to type.
 */
function resolvePartTarget(
  t: PartTarget,
  definitions: PartDefinition[],
  instances: PartInstance[],
): { definition: PartDefinition } | { error: string } {
  const partNumber = t.partNumber.trim().toLowerCase();
  if (!partNumber) return { error: "Enter a part number." };
  const revisions = definitions.filter(
    (d) => d.onshapePartNumber.trim().toLowerCase() === partNumber,
  );
  if (revisions.length === 0) {
    return { error: `No part ${t.partNumber.trim()} exists in the shop.` };
  }
  const latest = revisions.reduce((newest, d) =>
    d.createdAt > newest.createdAt || (d.createdAt === newest.createdAt && d.id > newest.id)
      ? d
      : newest,
  );
  if (isObsoleteRevision(latest, instances)) {
    return { error: `${partLabelOf(latest)} is obsolete.` };
  }
  if (!(Number(t.count) > 0)) return { error: "Enter how many instances the file is for." };
  return { definition: latest };
}

function PartTargetFields({
  value,
  onChange,
  definitions,
  instances,
  waiting,
  optionalHint,
}: {
  value: PartTarget;
  onChange: (v: PartTarget) => void;
  definitions: PartDefinition[];
  instances: PartInstance[];
  /** How many of a part can go in a batch now. */
  waiting: (d: PartDefinition) => number;
  optionalHint?: string;
}) {
  const match = value.partNumber.trim()
    ? resolvePartTarget({ ...value, count: "1" }, definitions, instances)
    : null;
  const compact = `${inputClass} !w-36 !px-2.5 !py-1.5 !text-xs font-mono`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TextField
        variant="plain"
        kind="sku"
        value={value.partNumber}
        onChange={(e) => onChange({ ...value, partNumber: e.target.value })}
        placeholder="Part number"
        aria-label="Part number"
        className={compact}
      />
      <CountInput value={value.count} onChange={(count) => onChange({ ...value, count })} />
      <span className="text-xs text-secondary-500">instances</span>
      <span className="text-xs text-secondary-400 w-full sm:w-auto">
        {match === null
          ? optionalHint
          : "error" in match
            ? match.error
            : `Rev ${match.definition.revision} · ${match.definition.name ? `${match.definition.name} · ` : ""}${waiting(match.definition)} waiting for a batch`}
      </span>
    </div>
  );
}

/** Asks which part, and how many of it, a file is for; a batch is made of them. */
function StartBatch({
  busy,
  definitions,
  instances,
  waiting,
  onStart,
  onCancel,
  onError,
}: {
  busy: boolean;
  definitions: PartDefinition[];
  instances: PartInstance[];
  waiting: (d: PartDefinition) => number;
  onStart: (d: PartDefinition, count: number) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [target, setTarget] = useState<PartTarget>(EMPTY_TARGET);
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-secondary-200 bg-page p-2.5">
      <span className="text-xs font-medium text-secondary-500">A batch of</span>
      <PartTargetFields
        value={target}
        onChange={setTarget}
        definitions={definitions}
        instances={instances}
        waiting={waiting}
        optionalHint="Its instances have to be waiting at a File Producer process"
      />
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          const resolved = resolvePartTarget(target, definitions, instances);
          if ("error" in resolved) onError(resolved.error);
          else onStart(resolved.definition, Number(target.count));
        }}
      >
        Start batch
      </Button>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
