import {
  Button,
  type ButtonSize,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Field,
  inputClass,
} from "@g3/ui";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { batchMembers, processNamer } from "../../shared/batches";
import { type InstanceRow, partInfoLabel, partLabel } from "../../shared/derive";
import {
  bulkMoveInstances,
  createBatch,
  deleteBatch,
  fetchOnshapeLinks,
  stageIntoBatch,
  unstageFromBatch,
} from "../../shared/getters";
import type { Batch, OnshapePartLink, PartDefinition } from "../../shared/types";
import { useAuthUser } from "../../shared/use-auth";
import type { ShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";
import { BatchMoveButtons } from "../batches/batch-actions";
import { BatchFileControls, BatchFileLine } from "../batches/batch-file";
import {
  BatchLink,
  BatchStatusBadge,
  CompleteButton,
  PriorityTag,
  formatTime,
  plural,
} from "../batches/batch-ui";
import { NoticeText } from "../files/file-ui";

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

const sectionHeading = "font-sans text-xs font-bold uppercase tracking-widest text-secondary-400";
const listCard = "bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200";

/**
 * Shop-floor view for a File Producer process. A part goes through it on its own, like at any
 * other process, or in a batch: parts that share one file and move as one. Stage parts into a
 * batch, give the batch its file, then start and complete the batch.
 */
export function ProducerSections({
  processId,
  rows,
  touch,
  data,
  showPartInfo,
  onChanged,
  onAdvance,
  onOpenPart,
}: {
  processId: number;
  rows: InstanceRow[];
  touch: boolean;
  data: ShopData;
  showPartInfo: boolean;
  onChanged: () => Promise<void>;
  /** Starts or completes one part that's in no batch. */
  onAdvance: (row: InstanceRow, to: "doing" | "done") => Promise<void>;
  /** Opens a part's shop view. */
  onOpenPart: (row: InstanceRow) => void;
}) {
  const user = useAuthUser();
  const processName = processNamer(data);
  const [onshapeLinks, setOnshapeLinks] = useState<OnshapePartLink[]>([]);
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Batches still here: not started, or in progress.
  const batches = useMemo(
    () => data.batches.filter((b) => b.processId === processId && b.producerStatus !== "done"),
    [data.batches, processId],
  );
  const resolveName = useUserNames(batches.map((b) => b.createdBy));

  // Onshape only decides whether part names are links, so losing it doesn't fail the view.
  useEffect(() => {
    fetchOnshapeLinks()
      .then(setOnshapeLinks)
      .catch(() => {});
  }, []);

  // Default the stage target to your newest batch, else the newest batch, else a new one.
  // Only when nothing valid is chosen: "a new batch" is a deliberate pick and must stick.
  // Skipped mid-action: a just-created batch is selected before the list reloads to include it.
  useEffect(() => {
    if (busy) return;
    if (target === NEW_BATCH || batches.some((b) => String(b.id) === target)) return;
    const mine = batches.filter((b) => b.createdBy === user?.userId);
    const pick = mine[mine.length - 1] ?? batches[batches.length - 1];
    setTarget(pick ? String(pick.id) : NEW_BATCH);
  }, [batches, busy, target, user?.userId]);

  const header = useMemo<PartHeaderContext>(() => {
    const links = new Map<string, OnshapePartLink[]>();
    for (const link of onshapeLinks) {
      const list = links.get(link.partNumber);
      if (list) list.push(link);
      else links.set(link.partNumber, [link]);
    }
    return { showInfo: showPartInfo, links };
  }, [onshapeLinks, showPartInfo]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.instance.id, r])), [rows]);

  // Parts here on their own: in no batch.
  const alone = (status: "todo" | "doing") =>
    groupByPart(
      rows.filter(
        (r) =>
          r.current?.processId === processId &&
          r.current.status === status &&
          r.current.batchId === null,
      ),
    );
  const doingGroups = alone("doing");
  const todoGroups = alone("todo");
  const count = (groups: PartGroup[]) => groups.reduce((n, g) => n + g.rows.length, 0);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      await onChanged();
      setBusy(false);
    }
  }

  /** One part on its own; the page it's on reloads and says what went wrong. */
  async function advance(row: InstanceRow, to: "doing" | "done") {
    setBusy(true);
    await onAdvance(row, to);
    setBusy(false);
  }

  function stage(targets: InstanceRow[]) {
    const chosen = target;
    const partInstanceIds = targets.map((r) => r.instance.id);
    run(async () => {
      let refused: string[];
      if (chosen === NEW_BATCH || !chosen) {
        const made = await createBatch({ processId, partInstanceIds });
        setTarget(String(made.batch.id));
        refused = made.refused;
      } else {
        refused = await stageIntoBatch(Number(chosen), partInstanceIds);
      }
      if (refused.length > 0) setNotice(refused.join(" "));
    });
  }

  const size: ButtonSize = touch ? "md" : "sm";
  const optionLabel = (b: Batch) =>
    `${b.label}${b.name === null && b.label !== `Batch ${b.number}` ? ` · Batch ${b.number}` : ""}`;
  const stageButton = (r: InstanceRow) => (
    <RowButton disabled={busy} onClick={() => stage([r])}>
      Stage
    </RowButton>
  );

  return (
    <PartHeader.Provider value={header}>
      {error && <ErrorBanner message={error} />}
      {notice && <NoticeText message={notice} />}

      {/* Batches */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionHeading}>
            Batches <span className="text-primary-600">{batches.length}</span>
          </h2>
          <Button
            variant="secondary"
            size={size}
            disabled={busy}
            onClick={() =>
              run(async () => setTarget(String((await createBatch({ processId })).batch.id)))
            }
          >
            New batch
          </Button>
        </div>
        {batches.length === 0 ? (
          <p className="text-secondary-400 text-sm">
            No batches here. Instances that share one file go in a batch: stage them from To Do
            below.
          </p>
        ) : (
          batches.map((batch) => {
            const staged = batchMembers(batch).flatMap((m) => rowById.get(m.partInstanceId) ?? []);
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
                    <span className="min-w-0 truncate text-sm font-semibold">
                      <BatchLink batch={batch} />
                    </span>
                    <BatchStatusBadge batch={batch} processName={processName} />
                    <span className="min-w-0 text-xs text-secondary-400">
                      {batch.label !== `Batch ${batch.number}` && `Batch ${batch.number} · `}
                      {batch.createdBy === "migration"
                        ? "carried over"
                        : resolveName(batch.createdBy)}{" "}
                      · {formatTime(batch.createdAt)} · {plural(staged.length, "instance")}
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
                    <BatchFileLine batch={batch} />
                  </div>
                </div>

                {staged.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <span className="text-sm text-secondary-400 flex-1">
                      Empty. Stage instances into it from To Do below.
                    </span>
                    <ConfirmButton
                      size={size}
                      label="Delete batch"
                      question={`Delete ${batch.label}?${batch.file ? " Its file stays in the library." : ""}`}
                      disabled={busy}
                      onConfirm={() => run(() => deleteBatch(batch.id))}
                    />
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
                        <RowButton
                          disabled={busy}
                          onClick={() => run(() => unstageFromBatch(batch.id, [r.instance.id]))}
                        >
                          Unstage
                        </RowButton>
                      )}
                    />
                  ))
                )}

                <div className="flex flex-wrap items-start gap-2 px-4 py-3 bg-secondary-50 rounded-b-xl">
                  <BatchFileControls
                    batch={batch}
                    batches={data.batches}
                    busy={busy}
                    size={size}
                    run={run}
                  />
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <BatchMoveButtons
                      batch={batch}
                      arrived
                      nextName={
                        batch.consumerProcessId === null
                          ? null
                          : processName(batch.consumerProcessId)
                      }
                      busy={busy}
                      size={touch ? "touch" : "sm"}
                      run={run}
                    />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* In Progress: parts on their own */}
      <section className="space-y-2">
        <h2 className={sectionHeading}>
          In Progress <span className="text-primary-600">{count(doingGroups)}</span>
        </h2>
        {doingGroups.length === 0 ? (
          <p className="text-secondary-400 text-sm">Nothing in progress here outside a batch.</p>
        ) : (
          <div className={listCard}>
            {doingGroups.map(({ key, rows: groupRows }) => (
              <PartGroup
                key={key}
                rows={groupRows}
                touch={touch}
                onOpenPart={onOpenPart}
                actions={
                  <>
                    <Button size={size} disabled={busy} onClick={() => stage(groupRows)}>
                      Stage all
                    </Button>
                    <CompleteButton
                      size={touch ? "touch" : "sm"}
                      hint="Do a quality check before marking these complete!"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          bulkMoveInstances(
                            processId,
                            groupRows.map((r) => r.instance.id),
                            "done",
                          ),
                        )
                      }
                    >
                      Mark all complete
                    </CompleteButton>
                  </>
                }
                renderRow={(r) => (
                  <>
                    {stageButton(r)}
                    <RowButton complete disabled={busy} onClick={() => advance(r, "done")}>
                      Mark as complete
                    </RowButton>
                  </>
                )}
              />
            ))}
          </div>
        )}
      </section>

      {/* To Do: parts on their own */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionHeading}>
            To Do <span className="text-primary-600">{count(todoGroups)}</span>
          </h2>
          {count(todoGroups) + count(doingGroups) > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-secondary-500">
              Stage into
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={`${inputClass} !w-auto !px-2 !py-1 !text-xs`}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {optionLabel(b)}
                  </option>
                ))}
                <option value={NEW_BATCH}>A new batch</option>
              </select>
            </label>
          )}
        </div>
        {todoGroups.length === 0 ? (
          <p className="text-secondary-400 text-sm">Nothing ready to start.</p>
        ) : (
          <div className={listCard}>
            {todoGroups.map(({ key, rows: groupRows }) => (
              <TodoGroup
                key={key}
                rows={groupRows}
                touch={touch}
                busy={busy}
                size={size}
                onStage={stage}
                onOpenPart={onOpenPart}
                onStartAll={() =>
                  run(() =>
                    bulkMoveInstances(
                      processId,
                      groupRows.map((r) => r.instance.id),
                      "doing",
                    ),
                  )
                }
                renderRow={(r) => (
                  <>
                    {stageButton(r)}
                    <RowButton disabled={busy} onClick={() => advance(r, "doing")}>
                      Start part
                    </RowButton>
                    <RowButton complete disabled={busy} onClick={() => advance(r, "done")}>
                      Mark as complete
                    </RowButton>
                  </>
                )}
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
  onStartAll,
  onOpenPart,
  renderRow,
}: {
  rows: InstanceRow[];
  touch: boolean;
  busy: boolean;
  size: ButtonSize;
  onStage: (targets: InstanceRow[]) => void;
  onStartAll: () => void;
  onOpenPart: (row: InstanceRow) => void;
  renderRow: (row: InstanceRow) => React.ReactNode;
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
      onOpenPart={onOpenPart}
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
          <Button variant="secondary" size={size} disabled={busy} onClick={onStartAll}>
            Start all
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
      renderRow={renderRow}
    />
  );
}

/**
 * A part header with its bulk actions, then one thin indented row per instance with that row's
 * own buttons. With `onOpenPart` an instance's number opens its shop view.
 */
function PartGroup({
  rows,
  touch,
  actions,
  renderRow,
  onOpenPart,
}: {
  rows: InstanceRow[];
  touch: boolean;
  actions: React.ReactNode;
  renderRow: (row: InstanceRow) => React.ReactNode;
  onOpenPart?: (row: InstanceRow) => void;
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
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">{actions}</div>
      </div>
      <ul className="mt-1.5 ml-2 border-l-2 border-secondary-200">
        {rows.map((r) => (
          <li
            key={r.instance.id}
            className={`flex items-center gap-2 pl-3 pr-1 text-xs hover:bg-secondary-50 ${touch ? "py-1.5" : "py-0.5"}`}
          >
            {onOpenPart ? (
              <button
                type="button"
                onClick={() => onOpenPart(r)}
                title="Open this part"
                className="w-10 shrink-0 text-left font-mono text-primary-600 underline hover:text-primary-700"
              >
                #{r.instance.instanceNumber}
              </button>
            ) : (
              <span className="font-mono text-secondary-900 w-10 shrink-0">
                #{r.instance.instanceNumber}
              </span>
            )}
            {r.instance.isPriority ? <PriorityTag /> : null}
            <span className="flex-1" />
            {renderRow(r)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small button on an instance's row; `complete` is the green one that completes it. */
function RowButton({
  disabled,
  complete = false,
  onClick,
  children,
}: {
  disabled: boolean;
  complete?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] font-semibold border rounded transition-colors disabled:opacity-50 shrink-0 ${
        complete
          ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700"
          : "text-secondary-500 border-secondary-200 hover:border-secondary-400 hover:text-primary-600"
      }`}
    >
      {children}
    </button>
  );
}
