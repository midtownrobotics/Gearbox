import { useCallback, useEffect, useRef, useState } from "react";
import type { InstanceRow } from "../../shared/derive";
import {
  deletePartFile,
  fetchPartFiles,
  partFileDownloadUrl,
  setFileAssignmentCount,
  unassignFileInstance,
  uploadPartFile,
} from "../../shared/getters";
import type { PartDefinition, PartFile, PartInstance } from "../../shared/types";
import { useKiosk } from "../../shared/use-auth";
import { useUserNames } from "../../shared/use-user-names";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`;
}

/** [1,2,3,4,6] → "#1–4, #6" */
export function formatInstanceRanges(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `#${sorted[i]}–${sorted[j]}` : `#${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

export const partLabelOf = (d: Pick<PartDefinition, "onshapePartNumber" | "revision">) =>
  `${d.onshapePartNumber} · Rev ${d.revision}`;

/**
 * A revision no file can be assigned to: one marked obsolete, or one whose every instance has
 * been made obsolete. The worker refuses the same ones.
 */
export function isObsoleteRevision(definition: PartDefinition, instances: PartInstance[]): boolean {
  if (definition.isObsolete) return true;
  const own = instances.filter((i) => i.partDefinitionId === definition.id);
  return own.length > 0 && own.every((i) => i.isStale);
}

/** Active (non-obsolete) instance ids of each part definition that no file covers yet. */
export function freeInstancesByPart(
  instances: PartInstance[],
  files: PartFile[],
): Map<number, number> {
  const covered = new Set(files.flatMap((f) => f.assignments.map((a) => a.partInstanceId)));
  const free = new Map<number, number>();
  for (const inst of instances) {
    if (inst.isStale || covered.has(inst.id)) continue;
    free.set(inst.partDefinitionId, (free.get(inst.partDefinitionId) ?? 0) + 1);
  }
  return free;
}

/** Sets a file's count on one part; returns a notice when fewer instances were free than asked. */
export async function assignCount(
  fileId: number,
  definition: PartDefinition,
  count: number,
): Promise<string | null> {
  const { requested, assigned } = await setFileAssignmentCount(fileId, definition.id, count);
  if (assigned >= requested) return null;
  return `Not enough instances of ${partLabelOf(definition)} without a file — assigned ${assigned} of the ${requested} requested.`;
}

/** Uploads to the library one at a time, then assigns `count` instances of `definition` to each. */
export async function uploadAndAssign(
  selected: File[],
  definition: PartDefinition | null,
  count: number,
): Promise<{ error: string | null; notices: string[] }> {
  const notices: string[] = [];
  for (const file of selected) {
    if (file.size > MAX_FILE_BYTES) {
      return { error: `${file.name} is over the 100 MB limit.`, notices };
    }
    try {
      const uploaded = await uploadPartFile(file);
      if (definition && count > 0) {
        const notice = await assignCount(uploaded.id, definition, count);
        if (notice) notices.push(`${file.name}: ${notice}`);
      }
    } catch (err) {
      return {
        error: `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`,
        notices,
      };
    }
  }
  return { error: null, notices };
}

/** Instances still being made: active, not complete, and on a non-obsolete part revision. */
export function productionRows(rows: InstanceRow[]): InstanceRow[] {
  return rows.filter(
    (r) => !r.instance.isStale && !r.definition.isObsolete && r.state !== "complete",
  );
}

/** Summarizes which in-production instances something covers, e.g. "Main Shaft (P-1 · Rev A) #1–3". */
export function describeUsage(rows: InstanceRow[]): string {
  const byPart = new Map<number, InstanceRow[]>();
  for (const r of rows) byPart.set(r.definition.id, [...(byPart.get(r.definition.id) ?? []), r]);
  return [...byPart.values()]
    .map(
      (list) =>
        `${list[0].definition.name || partLabelOf(list[0].definition)} (${partLabelOf(list[0].definition)}) ${formatInstanceRanges(list.map((r) => r.instance.instanceNumber))}`,
    )
    .join("; ");
}

export function InProductionBadge({ rows }: { rows: InstanceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <span
      title={`Used by ${rows.length} instance${rows.length === 1 ? "" : "s"} in production: ${describeUsage(rows)}`}
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-full px-2 py-0.5 shrink-0"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
      In production · {rows.length}
    </span>
  );
}

/** Confirms deleting something, warning loudly when production instances still use it. */
export function confirmDelete(name: string, inProduction: InstanceRow[], extra = ""): boolean {
  const warning =
    inProduction.length > 0
      ? `⚠ ${inProduction.length} instance${inProduction.length === 1 ? " that's" : "s that are"} still in production use${inProduction.length === 1 ? "s" : ""} it: ${describeUsage(inProduction)}.\n\n`
      : "";
  return window.confirm(`${warning}Delete ${name}? ${extra}This can't be undone.`);
}

export function confirmDeleteFile(file: PartFile, inProduction: InstanceRow[] = []): boolean {
  const n = file.assignments.length;
  return confirmDelete(
    file.filename,
    inProduction,
    n > 0 ? `It will be unassigned from ${n} instance${n === 1 ? "" : "s"}. ` : "",
  );
}

/**
 * Files covering instances of one part definition. Upload or pick an existing file and say how
 * many instances it covers; they're taken from instances that don't have a file yet.
 */
export function PartFilesPanel({
  definition,
  definitions,
  instances,
  currentInstanceId,
}: {
  definition: PartDefinition;
  definitions: PartDefinition[];
  instances: PartInstance[];
  currentInstanceId?: number;
}) {
  const kiosk = useKiosk();
  const [files, setFiles] = useState<PartFile[]>([]);
  const [library, setLibrary] = useState<PartFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [addCount, setAddCount] = useState("");
  const [existingId, setExistingId] = useState("");
  const resolveName = useUserNames(files.map((f) => f.uploadedBy));

  const active = instances.filter((i) => i.partDefinitionId === definition.id && !i.isStale);
  const free = freeInstancesByPart(active, files).get(definition.id) ?? 0;
  const currentNumber = instances.find((i) => i.id === currentInstanceId)?.instanceNumber;
  const currentFile = files.find((f) =>
    f.assignments.some((a) => a.partInstanceId === currentInstanceId),
  );

  const load = useCallback(async () => {
    try {
      setFiles(await fetchPartFiles(definition.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setLoading(false);
    }
  }, [definition.id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Default the "how many" box to every instance that's still free.
  useEffect(() => {
    if (!loading) setAddCount(String(free));
  }, [free, loading]);

  async function run(action: () => Promise<string[] | string | null | undefined>) {
    setBusy(true);
    setError(null);
    setNotices([]);
    try {
      const result = await action();
      if (typeof result === "string") setNotices([result]);
      else if (Array.isArray(result)) setNotices(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const count = Number(addCount) || 0;

  function handleUpload(selected: File[]) {
    if (selected.length === 0) return;
    run(async () => {
      const { error: uploadError, notices: n } = await uploadAndAssign(selected, definition, count);
      if (uploadError) throw new Error(uploadError);
      return n;
    });
  }

  function handleAttachExisting() {
    const id = Number(existingId);
    if (!id || count < 1) return;
    const existing = files.find((f) => f.id === id);
    const already = existing?.assignments.filter((a) => a.partDefinitionId === definition.id);
    run(async () => {
      const notice = await assignCount(id, definition, (already?.length ?? 0) + count);
      setExistingId("");
      setLibrary(null);
      return notice;
    });
  }

  function loadLibrary() {
    if (library) return;
    fetchPartFiles()
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-steel-dark">
        {active.length - free} of {active.length} active instance{active.length === 1 ? "" : "s"}{" "}
        have a file · <span className="font-semibold text-ink">{free} without</span>
        {currentNumber !== undefined && (
          <>
            {" "}
            · This instance (#{currentNumber}):{" "}
            <span className="font-semibold text-ink">{currentFile?.filename ?? "no file"}</span>
          </>
        )}
      </p>

      {error && <ErrorText message={error} />}
      {notices.map((n) => (
        <NoticeText key={n} message={n} />
      ))}

      {loading ? (
        <p className="text-sm text-steel">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-steel">No files assigned to this part.</p>
      ) : (
        <ul className="divide-y divide-steel/20 border border-steel/25 rounded-lg">
          {files.map((file) => {
            const otherParts = [
              ...new Set(
                file.assignments
                  .filter((a) => a.partDefinitionId !== definition.id)
                  .map((a) => a.partDefinitionId),
              ),
            ]
              .map((id) => definitions.find((d) => d.id === id))
              .filter((d): d is PartDefinition => !!d);
            return (
              <li key={file.id} className="px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate" title={file.filename}>
                      {file.filename}
                    </p>
                    <FileMeta file={file} uploader={resolveName(file.uploadedBy)} />
                  </div>
                  <DownloadLink file={file} />
                  {!kiosk.active && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirmDeleteFile(file))
                          run(() => deletePartFile(file.id).then(() => null));
                      }}
                      className="px-2.5 py-1 text-xs font-medium border border-crimson/40 text-crimson hover:bg-crimson-tint rounded transition-colors disabled:opacity-50 shrink-0"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <AssignmentGroup
                  file={file}
                  definition={definition}
                  canEdit={!kiosk.active}
                  busy={busy}
                  highlightInstanceId={currentInstanceId}
                  run={run}
                />
                {otherParts.length > 0 && (
                  <p className="text-xs text-steel-dark">
                    Also covers:{" "}
                    {otherParts
                      .map(
                        (d) =>
                          `${partLabelOf(d)} ${formatInstanceRanges(
                            file.assignments
                              .filter((a) => a.partDefinitionId === d.id)
                              .map((a) => a.instanceNumber),
                          )}`,
                      )
                      .join("; ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!kiosk.active && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 bg-mist border border-steel/25 rounded-lg">
          <span className="text-xs font-medium text-steel-dark">Assign</span>
          <CountInput value={addCount} onChange={setAddCount} />
          <span className="text-xs text-steel-dark">instance{count === 1 ? "" : "s"} to</span>
          <UploadButton busy={busy} onFiles={handleUpload} label="new upload" />
          <span className="text-xs text-steel">or</span>
          <select
            value={existingId}
            onFocus={loadLibrary}
            onPointerDown={loadLibrary}
            onChange={(e) => setExistingId(e.target.value)}
            className="bg-paper border border-steel/40 rounded-lg px-2.5 py-1.5 text-xs text-steel-dark focus:outline-none focus:border-crimson max-w-[14rem]"
          >
            <option value="">existing file…</option>
            {library === null ? (
              <option disabled>Loading…</option>
            ) : (
              [...library]
                .sort((a, b) => a.filename.localeCompare(b.filename))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.filename}
                  </option>
                ))
            )}
          </select>
          <button
            type="button"
            onClick={handleAttachExisting}
            disabled={busy || !existingId || count < 1}
            className="px-3 py-1.5 text-xs font-semibold bg-crimson hover:bg-crimson-dark text-paper rounded-lg transition-colors disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      )}
    </div>
  );
}

/** One file's instances on one part: a chip per instance (× to unassign) and a count setter. */
export function AssignmentGroup({
  file,
  definition,
  canEdit,
  busy,
  highlightInstanceId,
  run,
}: {
  file: PartFile;
  definition: PartDefinition;
  canEdit: boolean;
  busy: boolean;
  highlightInstanceId?: number;
  run: (action: () => Promise<string | null>) => void;
}) {
  const mine = file.assignments.filter((a) => a.partDefinitionId === definition.id);
  const [draft, setDraft] = useState(String(mine.length));

  useEffect(() => setDraft(String(mine.length)), [mine.length]);

  const next = Number(draft);
  const changed = draft !== "" && next !== mine.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mine.length === 0 && <span className="text-xs text-steel">No instances of this part.</span>}
      {mine.map((a) => (
        <span
          key={a.partInstanceId}
          className={`inline-flex items-center gap-0.5 text-xs font-mono rounded-full pl-2 pr-1 py-0.5 border ${
            a.partInstanceId === highlightInstanceId
              ? "bg-crimson-tint border-crimson/40 text-crimson-dark"
              : "bg-steel-tint border-steel/30 text-steel-dark"
          }`}
        >
          #{a.instanceNumber}
          {canEdit && (
            <button
              type="button"
              title={`Unassign #${a.instanceNumber}`}
              disabled={busy}
              onClick={() =>
                run(() => unassignFileInstance(file.id, a.partInstanceId).then(() => null))
              }
              className="w-4 h-4 leading-none rounded-full text-steel hover:text-crimson hover:bg-crimson-tint disabled:opacity-50"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <span className="inline-flex items-center gap-1 ml-1">
          <span className="text-xs text-steel">Count</span>
          <CountInput value={draft} onChange={setDraft} />
          <button
            type="button"
            disabled={busy || !changed}
            onClick={() => run(() => assignCount(file.id, definition, next))}
            className="px-2 py-0.5 text-xs font-semibold border border-steel/40 text-steel-dark hover:text-ink hover:border-crimson/50 rounded transition-colors disabled:opacity-40"
          >
            Set
          </button>
        </span>
      )}
    </div>
  );
}

/** Digits-only text input so the field can be cleared while typing. */
export function CountInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => {
        if (/^\d{0,4}$/.test(e.target.value)) onChange(e.target.value);
      }}
      className="w-14 bg-paper border border-steel/40 rounded px-2 py-0.5 text-xs text-ink text-center focus:outline-none focus:border-crimson"
    />
  );
}

export function UploadButton({
  busy,
  disabled,
  onFiles,
  label = "+ Upload Files",
  multiple = true,
  className,
}: {
  busy: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  multiple?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires onChange.
          e.target.value = "";
          onFiles(picked);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy || disabled}
        className={
          className ??
          "px-3 py-1.5 text-xs font-semibold border border-steel/40 bg-paper text-steel-dark hover:text-ink hover:border-crimson/50 rounded-lg transition-colors disabled:opacity-50"
        }
      >
        {busy ? "Working…" : label}
      </button>
    </>
  );
}

/**
 * The top of a file's row: its name and details, then its status and buttons. On a narrow screen
 * those go under the details, so the name has the whole row and is shown in full.
 */
export function FileHeading({
  name,
  details,
  children,
}: {
  name: string;
  details: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 sm:flex-1">
        <p className="text-sm font-medium text-ink break-all sm:truncate" title={name}>
          {name}
        </p>
        {details}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:gap-3">{children}</div>
    </div>
  );
}

export function FileMeta({ file, uploader }: { file: PartFile; uploader: string }) {
  return (
    <p className="text-xs text-steel">
      {formatBytes(file.fileSize)} · {new Date(file.createdAt).toLocaleDateString()} · {uploader}
    </p>
  );
}

export function DownloadLink({ file }: { file: PartFile }) {
  return (
    <a
      href={partFileDownloadUrl(file.id)}
      download={file.filename}
      className="px-2.5 py-1 text-xs font-medium border border-steel/40 text-steel hover:text-ink rounded transition-colors shrink-0"
    >
      Download
    </a>
  );
}

export function ErrorText({ message }: { message: string }) {
  return (
    <p className="text-sm text-crimson-dark bg-crimson-tint border border-crimson/30 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}

export function NoticeText({ message }: { message: string }) {
  return (
    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}
