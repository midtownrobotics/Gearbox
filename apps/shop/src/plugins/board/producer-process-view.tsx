import {
  Button,
  type ButtonSize,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Field,
  inputClass,
} from "@g3/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type InstanceRow, partInfoLabel, partLabel } from "../../shared/derive";
import {
  completeStagingBatch,
  createStagingBatch,
  deleteStagingBatch,
  fetchOnshapeLinks,
  fetchPartFiles,
  fetchStagingBatches,
  setStagingBatchFile,
  stageIntoBatch,
  unstageFromBatch,
  uploadPartFile,
} from "../../shared/getters";
import type { OnshapePartLink, PartDefinition, PartFile, StagingBatch } from "../../shared/types";
import { useAuthUser, useKiosk } from "../../shared/use-auth";
import { useUserNames } from "../../shared/use-user-names";
import { FilePickerModal } from "../files/file-picker-modal";
import { DownloadLink, UploadButton } from "../files/part-files-panel";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * What a part header shows besides its name: material and thickness on a process that requires
 * part info, and the team's Onshape links by part number, newest release first.
 */
type PartHeaderContext = { showInfo: boolean; links: Map<string, OnshapePartLink[]> };
const PartHeader = createContext<PartHeaderContext>({ showInfo: false, links: new Map() });
const NEW_BATCH = "new";

type PartGroup = { key: number; rows: InstanceRow[] };

/** Groups by part definition; priority instances first, then by instance number. */
function groupByPart(rows: InstanceRow[]): PartGroup[] {
  const map = new Map<number, InstanceRow[]>();
  for (const r of rows) {
    const list = map.get(r.definition.id) ?? [];
    list.push(r);
    map.set(r.definition.id, list);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      rows: list.sort(
        (a, b) =>
          b.instance.isPriority - a.instance.isPriority ||
          a.instance.instanceNumber - b.instance.instanceNumber,
      ),
    }))
    .sort((a, b) =>
      (a.rows[0].definition.name ?? "").localeCompare(b.rows[0].definition.name ?? ""),
    );
}

/**
 * Where a part is in Onshape: the release that gave it the revision being made, else its newest
 * one, since a part's number is what Onshape releases and a hand-typed revision may match none.
 */
function onshapeLinkFor(
  links: Map<string, OnshapePartLink[]>,
  definition: PartDefinition,
): OnshapePartLink | null {
  const released = links.get(definition.onshapePartNumber);
  if (!released) return null;
  return released.find((l) => l.revision === definition.revision) ?? released[0] ?? null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatStarted = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Shop-floor view for a File Producer process. Several staging batches can be open at once,
 * each owned by whoever started it and sharing one file. Stage To Do instances into a batch,
 * give the batch a file, then complete it to move every instance to its next process.
 */
export function ProducerSections({
  processId,
  rows,
  touch,
  definitions,
  showPartInfo,
  onChanged,
}: {
  processId: number;
  rows: InstanceRow[];
  touch: boolean;
  definitions: PartDefinition[];
  showPartInfo: boolean;
  onChanged: () => Promise<void>;
}) {
  const kiosk = useKiosk();
  const user = useAuthUser();
  const [files, setFiles] = useState<PartFile[]>([]);
  const [batches, setBatches] = useState<StagingBatch[]>([]);
  const [onshapeLinks, setOnshapeLinks] = useState<OnshapePartLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [pickerBatchId, setPickerBatchId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveName = useUserNames(batches.map((b) => b.createdBy));

  const load = useCallback(async () => {
    try {
      // Onshape only decides whether part names are links, so losing it doesn't fail the view.
      const [nextFiles, nextBatches, nextLinks] = await Promise.all([
        fetchPartFiles(),
        fetchStagingBatches(processId),
        fetchOnshapeLinks().catch(() => []),
      ]);
      setFiles(nextFiles);
      setBatches(nextBatches);
      setOnshapeLinks(nextLinks);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staging batches.");
    }
  }, [processId]);

  useEffect(() => {
    load();
  }, [load]);

  // Default the stage target to your newest batch, else the newest batch, else a new one.
  // Only when nothing valid is chosen: "a new batch" is a deliberate pick and must stick.
  // Skipped mid-action: a just-created batch is selected before the list reloads to include it.
  useEffect(() => {
    if (!loaded || busy) return;
    if (target === NEW_BATCH || batches.some((b) => String(b.id) === target)) return;
    const mine = batches.filter((b) => b.createdBy === user?.userId);
    const pick = mine[mine.length - 1] ?? batches[batches.length - 1];
    setTarget(pick ? String(pick.id) : NEW_BATCH);
  }, [batches, busy, loaded, target, user?.userId]);

  const header = useMemo<PartHeaderContext>(() => {
    const links = new Map<string, OnshapePartLink[]>();
    for (const link of onshapeLinks) {
      const list = links.get(link.partNumber);
      if (list) list.push(link);
      else links.set(link.partNumber, [link]);
    }
    return { showInfo: showPartInfo, links };
  }, [onshapeLinks, showPartInfo]);

  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.instance.id, r])), [rows]);
  const inABatch = useMemo(() => new Set(batches.flatMap((b) => b.partInstanceIds)), [batches]);

  // To Do includes anything in progress here that isn't in a batch, so it can be batched.
  const todoGroups = groupByPart(
    rows.filter(
      (r) =>
        r.current?.processId === processId &&
        (r.current.status === "todo" ||
          (r.current.status === "doing" && !inABatch.has(r.instance.id))),
    ),
  );
  const todoCount = todoGroups.reduce((n, g) => n + g.rows.length, 0);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      await Promise.all([onChanged(), load()]);
      setBusy(false);
    }
  }

  function stage(targets: InstanceRow[]) {
    const chosen = target;
    run(async () => {
      const batchId =
        chosen === NEW_BATCH || !chosen ? await createStagingBatch(processId) : Number(chosen);
      setTarget(String(batchId));
      await stageIntoBatch(
        batchId,
        targets.map((r) => r.instance.id),
      );
    });
  }

  function uploadBatchFile(batchId: number, file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is over the 100 MB limit.`);
      return;
    }
    run(async () => {
      const uploaded = await uploadPartFile(file);
      await setStagingBatchFile(batchId, uploaded.id);
    });
  }

  const btn = touch ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs";
  const size: ButtonSize = touch ? "md" : "sm";
  const pickerBatch = batches.find((b) => b.id === pickerBatchId) ?? null;
  const batchLabel = (b: StagingBatch) =>
    `Batch ${b.id} · ${b.createdBy === "migration" ? "carried over" : resolveName(b.createdBy)}`;

  return (
    <PartHeader.Provider value={header}>
      {pickerBatch && (
        <FilePickerModal
          files={files.filter((f) => f.id !== pickerBatch.fileId)}
          definitions={definitions}
          title={`${pickerBatch.fileId ? "Replace the file for" : "Choose a file for"} batch ${pickerBatch.id}`}
          confirmLabel={pickerBatch.fileId ? "Replace file" : "Use this file"}
          onPick={(file) => {
            setPickerBatchId(null);
            run(() => setStagingBatchFile(pickerBatch.id, file.id));
          }}
          onUploadNew={(file) => {
            setPickerBatchId(null);
            uploadBatchFile(pickerBatch.id, file);
          }}
          onClose={() => setPickerBatchId(null)}
        />
      )}
      {error && <ErrorBanner message={error} />}

      {/* Staging batches */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
            Staging batches <span className="text-primary-600">{batches.length}</span>
          </h2>
        </div>
        {batches.length === 0 ? (
          <p className="text-secondary-400 text-sm">
            No open batches. Staging from To Do below starts one.
          </p>
        ) : (
          batches.map((batch) => {
            const staged = batch.partInstanceIds.flatMap((id) => rowById.get(id) ?? []);
            const file = batch.fileId ? (fileById.get(batch.fileId) ?? null) : null;
            const isTarget = target === String(batch.id);
            return (
              <div
                key={batch.id}
                className={`bg-surface border rounded-xl divide-y divide-secondary-200 ${
                  isTarget
                    ? "border-primary-500 ring-1 ring-primary-500/20"
                    : "border-secondary-200"
                }`}
              >
                <div className="px-4 py-2.5 bg-secondary-50 rounded-t-xl space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-secondary-900">
                      {batchLabel(batch)}
                    </span>
                    <span className="text-xs text-secondary-400">
                      started {formatStarted(batch.createdAt)} · {plural(staged.length, "instance")}
                    </span>
                    <span className="flex-1" />
                    {isTarget ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-600">
                        Staging here
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setTarget(String(batch.id))}
                        className="text-xs text-secondary-500 hover:text-primary-600 underline"
                      >
                        Stage here
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-secondary-400">
                      File
                    </span>
                    {file ? (
                      <>
                        <span
                          className="text-sm font-semibold text-secondary-900 truncate min-w-0 flex-1"
                          title={file.filename}
                        >
                          {file.filename}
                        </span>
                        <DownloadLink file={file} />
                      </>
                    ) : (
                      <span className="text-sm text-secondary-500 flex-1">No file yet</span>
                    )}
                  </div>
                </div>

                {staged.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <span className="text-sm text-secondary-400 flex-1">
                      Empty — stage instances from To Do below.
                    </span>
                    <Button
                      variant="danger"
                      size={size}
                      disabled={busy}
                      onClick={() => run(() => deleteStagingBatch(batch.id))}
                    >
                      Delete batch
                    </Button>
                  </div>
                ) : (
                  groupByPart(staged).map(({ key, rows: groupRows }) => (
                    <PartGroup
                      key={key}
                      rows={groupRows}
                      touch={touch}
                      actions={
                        <Button
                          variant="secondary"
                          size={size}
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              unstageFromBatch(
                                batch.id,
                                groupRows.map((r) => r.instance.id),
                              ),
                            )
                          }
                        >
                          Unstage all
                        </Button>
                      }
                      renderRow={(r) => (
                        <>
                          <span className="flex-1" />
                          <RowButton
                            disabled={busy}
                            onClick={() => run(() => unstageFromBatch(batch.id, [r.instance.id]))}
                          >
                            Unstage
                          </RowButton>
                        </>
                      )}
                    />
                  ))
                )}

                <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-secondary-50 rounded-b-xl">
                  {kiosk.active ? (
                    <span className="text-xs text-secondary-500">
                      Changing the file needs a regular sign-in — kiosks can't upload.
                    </span>
                  ) : (
                    <>
                      <UploadButton
                        busy={busy}
                        multiple={false}
                        onFiles={([f]) => f && uploadBatchFile(batch.id, f)}
                        label="Upload file"
                        variant="primary"
                        size={size}
                      />
                      <Button
                        variant="secondary"
                        size={size}
                        disabled={busy}
                        onClick={() => setPickerBatchId(batch.id)}
                      >
                        Choose existing file
                      </Button>
                      {file && (
                        <ConfirmButton
                          size={size}
                          label="Remove file"
                          confirmLabel="Remove it"
                          question={`Remove ${file.filename} from batch ${batch.id}? The file stays in the library.`}
                          disabled={busy}
                          onConfirm={() => run(() => setStagingBatchFile(batch.id, null))}
                        />
                      )}
                    </>
                  )}
                  <span className="relative group ml-auto">
                    <button
                      type="button"
                      disabled={busy || !file || staged.length === 0}
                      onClick={() => run(() => completeStagingBatch(batch.id))}
                      className={`${btn} font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50`}
                    >
                      Mark {plural(staged.length, "instance")} complete
                    </button>
                    <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:block whitespace-nowrap bg-secondary-900 text-surface text-xs rounded-md px-2.5 py-1.5 shadow-lg">
                      {!file
                        ? "Add a file to this batch first"
                        : "Moves every instance in this batch to its next process"}
                    </span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* To Do */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
            To Do <span className="text-primary-600">{todoCount}</span>
          </h2>
          {todoCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-secondary-500">
              Stage into
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={`${inputClass} !w-auto !px-2 !py-1 !text-xs`}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {batchLabel(b)}
                  </option>
                ))}
                <option value={NEW_BATCH}>A new batch</option>
              </select>
            </label>
          )}
        </div>
        {todoGroups.length === 0 ? (
          <p className="text-secondary-400 text-sm">Nothing ready to stage.</p>
        ) : (
          <div className="bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200">
            {todoGroups.map(({ key, rows: groupRows }) => (
              <TodoGroup
                key={key}
                rows={groupRows}
                touch={touch}
                busy={busy}
                size={size}
                onStage={stage}
              />
            ))}
          </div>
        )}
      </section>
    </PartHeader.Provider>
  );
}

function TodoGroup({
  rows,
  touch,
  busy,
  size,
  onStage,
}: {
  rows: InstanceRow[];
  touch: boolean;
  busy: boolean;
  size: ButtonSize;
  onStage: (targets: InstanceRow[]) => void;
}) {
  const max = rows.length;
  // How many to stage, while the pop-up that asks is open.
  const [count, setCount] = useState<string | null>(null);
  const [countError, setCountError] = useState(false);

  function stageSome() {
    const n = Number((count ?? "").trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
      setCountError(true);
      return;
    }
    setCount(null);
    onStage(rows.slice(0, n));
  }

  return (
    <PartGroup
      rows={rows}
      touch={touch}
      actions={
        <>
          <Button size={size} disabled={busy} onClick={() => onStage(rows)}>
            Stage all
          </Button>
          <Button
            variant="secondary"
            size={size}
            disabled={busy}
            onClick={() => {
              setCountError(false);
              setCount(String(max));
            }}
          >
            Stage some
          </Button>
          {count !== null && (
            <Dialog title="Stage some" onClose={() => setCount(null)}>
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  stageSome();
                }}
              >
                <Field label={`How many ${rows[0].definition.name} instances? (1 to ${max})`}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={max}
                    value={count}
                    onChange={(e) => {
                      setCount(e.target.value);
                      setCountError(false);
                    }}
                    className={inputClass}
                    // biome-ignore lint/a11y/noAutofocus: the pop-up was just opened to type this
                    autoFocus
                  />
                </Field>
                {countError && <ErrorBanner message={`Enter a whole number from 1 to ${max}.`} />}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Stage</Button>
                  <Button variant="secondary" onClick={() => setCount(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Dialog>
          )}
        </>
      }
      renderRow={(r) => (
        <>
          <span className="flex-1" />
          <RowButton disabled={busy} onClick={() => onStage([r])}>
            Stage
          </RowButton>
        </>
      )}
    />
  );
}

/** A part header with its bulk actions, then one thin indented row per instance. */
function PartGroup({
  rows,
  touch,
  actions,
  renderRow,
}: {
  rows: InstanceRow[];
  touch: boolean;
  actions: React.ReactNode;
  renderRow: (row: InstanceRow) => React.ReactNode;
}) {
  const { showInfo, links } = useContext(PartHeader);
  const first = rows[0];
  const onshape = onshapeLinkFor(links, first.definition);
  const name = (
    <>
      {first.definition.name}
      {showInfo && partInfoLabel(first.definition) && (
        <span className="font-normal text-secondary-500"> — {partInfoLabel(first.definition)}</span>
      )}
    </>
  );
  return (
    <div className={`px-4 ${touch ? "py-3" : "py-2.5"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex-1 min-w-0">
          {onshape?.part ? (
            <a
              href={onshape.part}
              target="_blank"
              rel="noreferrer"
              title="Open this part in Onshape"
              className="block max-w-full truncate text-sm font-semibold text-primary-600 underline hover:text-primary-700 transition-colors"
            >
              {name}
            </a>
          ) : (
            <p className="text-sm font-semibold text-secondary-900 truncate">{name}</p>
          )}
          <p className="text-xs font-mono text-secondary-400 truncate">
            {partLabel(first)} · {plural(rows.length, "instance")}
            {onshape && (
              <>
                {" · "}
                <a
                  href={onshape.release}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the release this part came from in Onshape"
                  className="text-secondary-500 underline hover:text-primary-600 transition-colors"
                >
                  Release
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
      </div>
      <ul className="mt-1.5 ml-2 border-l-2 border-secondary-200">
        {rows.map((r) => (
          <li
            key={r.instance.id}
            className={`flex items-center gap-2 pl-3 pr-1 text-xs hover:bg-secondary-50 ${touch ? "py-1.5" : "py-0.5"}`}
          >
            <span className="font-mono text-secondary-900 w-10 shrink-0">
              #{r.instance.instanceNumber}
            </span>
            {r.instance.isPriority ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-300 rounded px-1">
                Priority
              </span>
            ) : null}
            {renderRow(r)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RowButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-0.5 text-[11px] font-semibold text-secondary-500 border border-secondary-200 hover:border-secondary-400 hover:text-primary-600 rounded transition-colors disabled:opacity-50 shrink-0"
    >
      {children}
    </button>
  );
}
