import {
  Badge,
  Button,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Loading,
  SuccessBanner,
  TextField,
} from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  batchArrival,
  batchComplete,
  batchMembers,
  batchRemoved,
  batchStage,
  batchStatusText,
  processNamer,
} from "../../shared/batches";
import { type InstanceRow, STATE_META, buildInstanceRows } from "../../shared/derive";
import { deleteBatch, renameBatch, sendInstanceBack, unstageFromBatch } from "../../shared/getters";
import { processPath } from "../../shared/nav";
import type { Batch, BatchInstance, PartDefinition } from "../../shared/types";
import { type ShopData, refreshShopData, useShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";
import { NoticeText, formatBytes, partLabelOf } from "../files/file-ui";
import { Meta, Section } from "../parts/part-card";
import { BatchMoveButtons, DuplicateBatchButton, SendBatchBackDialog } from "./batch-actions";
import { BatchFileControls } from "./batch-file";
import {
  BatchStatusBadge,
  FileLink,
  InstanceLink,
  PartNameLink,
  PriorityTag,
  formatDay,
  formatTime,
  plural,
} from "./batch-ui";

/** A process's name as a link, as a part's own view draws it. */
const processLink =
  "font-semibold text-secondary-900 hover:text-primary-600 underline transition-colors";

/**
 * A batch's detail view, over the whole screen like a part's: its file, what it is, the instances
 * in it and where its parts are. It opens over whatever page asked for it (`?batch=<id>` in the
 * address, which `BatchLink` sets) and closing it leaves that page as it was. A batch has no shop
 * view of its own, so this is the one view of a batch everywhere, kiosks included.
 */
export function BatchSheet() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, error } = useShopData();
  const param = searchParams.get("batch");

  // What's shown is what the page already had; ask again so it's current.
  useEffect(() => {
    if (param) refreshShopData();
  }, [param]);

  if (!param) return null;
  const show = (id: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (id === null) next.delete("batch");
    else next.set("batch", String(id));
    setSearchParams(next, { replace: true });
  };
  const close = () => show(null);
  const batch = data?.batches.find((b) => b.id === Number(param));

  if (!data || !batch) {
    return (
      <Sheet title="Batch" onClose={close}>
        {error ? (
          <ErrorBanner message={error} />
        ) : data ? (
          <p className="text-sm text-secondary-500">
            This batch doesn't exist any more. It may have been deleted.
          </p>
        ) : (
          <Loading />
        )}
      </Sheet>
    );
  }
  return <BatchDetail key={batch.id} batch={batch} data={data} onClose={close} onOpen={show} />;
}

/** The full-screen frame: a bar with the title and ✕ that stays put, and the page under it. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-3xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-secondary-200 bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-2 text-3xl leading-none text-secondary-400 hover:text-secondary-900"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4 px-5 pb-8 pt-4">{children}</div>
      </div>
    </div>
  );
}

/** Where a part is now: "In Progress at Router", "Complete". */
function whereText(row: InstanceRow, processName: (id: number) => string) {
  if (!row.current) return STATE_META[row.state].label;
  return `${STATE_META[row.state].label} at ${processName(row.current.processId)}`;
}

function BatchDetail({
  batch,
  data,
  onClose,
  onOpen,
}: {
  batch: Batch;
  data: ShopData;
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  // The instance Send back was pressed for, while the pop-up that asks is open.
  const [sendingOne, setSendingOne] = useState<{ id: number; label: string } | null>(null);
  const processName = processNamer(data);

  // Obsolete parts included: one that's in the batch is still listed, marked.
  const rowById = useMemo(
    () => new Map(buildInstanceRows(data, { includeStale: true }).map((r) => [r.instance.id, r])),
    [data],
  );
  const liveRowById = useMemo(
    () => new Map([...rowById].filter(([, r]) => !r.instance.isStale)),
    [rowById],
  );
  const members = batchMembers(batch);
  const removed = batchRemoved(batch);
  const stage = batchStage(batch);
  const arrival = batchArrival(batch, liveRowById);
  const made = processName(batch.processId);
  const used = batch.consumerProcessId === null ? null : processName(batch.consumerProcessId);
  const resolveName = useUserNames([batch.createdBy, ...removed.map((r) => r.removedBy)]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      await refreshShopData();
      setBusy(false);
    }
  }

  const partIds = [...new Set(batch.instances.map((i) => i.partDefinitionId))];
  const definitionOf = (id: number) => data.definitions.find((d) => d.id === id);

  return (
    <Sheet
      onClose={onClose}
      title={
        <BatchTitle batch={batch} busy={busy} run={run}>
          <BatchStatusBadge batch={batch} processName={processName} />
        </BatchTitle>
      }
    >
      {error && <ErrorBanner message={error} />}
      {notice && <SuccessBanner message={notice} />}

      <NextStep
        batch={batch}
        arrival={arrival}
        processName={processName}
        whereOf={(row) => whereText(row, processName)}
      >
        <BatchMoveButtons
          batch={batch}
          arrived={arrival.all}
          nextName={used}
          busy={busy}
          size="md"
          run={run}
        />
      </NextStep>

      <Section title="File">
        {batch.file ? (
          <div className="space-y-1">
            <p className="break-all text-sm font-semibold">
              <FileLink file={batch.file} />
            </p>
            <p className="text-xs text-secondary-400">
              {formatBytes(batch.file.fileSize)} · uploaded {formatDay(batch.file.createdAt)}
            </p>
            {batch.file.obsolete && (
              <NoticeText message="This file was made for a part that's now obsolete. It can't go on another batch." />
            )}
          </div>
        ) : (
          <p className="text-sm text-secondary-400">No file.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BatchFileControls batch={batch} batches={data.batches} busy={busy} run={run} />
        </div>
      </Section>

      <Section title="Information">
        <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
          <Meta label="Name" value={batch.label} />
          <Meta label="Batch Number" value={String(batch.number)} mono />
          <Meta label="Status" value={batchStatusText(batch, processName)} />
          <Meta
            label="File Producer"
            value={
              <Link to={processPath(batch.processId)} onClick={onClose} className={processLink}>
                {made}
              </Link>
            }
          />
          <Meta
            label="File Consumer"
            value={
              batch.consumerProcessId === null ? (
                "—"
              ) : (
                <Link
                  to={processPath(batch.consumerProcessId)}
                  onClick={onClose}
                  className={processLink}
                >
                  {used}
                </Link>
              )
            }
          />
          <Meta
            label="Instances"
            value={`${members.length}${removed.length > 0 ? `, ${removed.length} sent back` : ""}`}
          />
          <Meta label="Created" value={formatTime(batch.createdAt)} />
          <Meta
            label="Created By"
            value={batch.createdBy === "migration" ? "Carried over" : resolveName(batch.createdBy)}
          />
          {batch.closedAt !== null && (
            <Meta label={`${made} Complete`} value={formatTime(batch.closedAt)} />
          )}
          {batch.completedAt !== null && used && (
            <Meta label={`${used} Complete`} value={formatTime(batch.completedAt)} />
          )}
        </dl>
      </Section>

      <Section title="Instances">
        {batch.instances.length === 0 ? (
          <p className="text-sm text-secondary-400">
            Nothing is in this batch yet. Stage instances into it at{" "}
            <Link to={processPath(batch.processId)} onClick={onClose} className={processLink}>
              {made}
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-4">
            {partIds.map((id) => (
              <PartInstances
                key={id}
                definition={definitionOf(id)}
                instances={batch.instances.filter((i) => i.partDefinitionId === id)}
                rowById={rowById}
                whereOf={(row) => whereText(row, processName)}
                resolveName={resolveName}
                action={(instance, label) =>
                  stage.at === "producer" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(() => unstageFromBatch(batch.id, [instance.partInstanceId]))
                      }
                    >
                      Unstage
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => setSendingOne({ id: instance.partInstanceId, label })}
                    >
                      Send back
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Status">
        {arrival.live.length === 0 ? (
          <p className="text-sm text-secondary-400">
            No instances in this batch are in production.
          </p>
        ) : (
          <div className="space-y-3">
            {partIds.map((id) => {
              const rows = arrival.live.filter((r) => r.definition.id === id);
              if (rows.length === 0) return null;
              return (
                <div key={id} className="space-y-1.5">
                  <p className="text-xs font-semibold text-secondary-500">
                    <PartNameLink definition={rows[0].definition} /> ·{" "}
                    {plural(rows.length, "instance")}
                  </p>
                  <PartFlow rows={rows} processName={processName} onNavigate={onClose} />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <div className="flex flex-wrap items-start gap-2">
        {batch.producerStatus !== "todo" && (
          <Button variant="secondary" disabled={busy} onClick={() => setSendingBack(true)}>
            Send batch back
          </Button>
        )}
        <DuplicateBatchButton
          batch={batch}
          processName={processName}
          busy={busy}
          onMade={async (copy) => {
            await refreshShopData();
            onOpen(copy.id);
          }}
        />
        {batch.producerStatus !== "done" && (
          <ConfirmButton
            label="Delete batch"
            question={`Delete ${batch.label}?${
              members.length > 0
                ? ` Its ${plural(members.length, "instance")} go${members.length === 1 ? "es" : ""} back to To Do at ${made}.`
                : ""
            }${batch.file ? " Its file stays in the library." : ""}`}
            disabled={busy}
            onConfirm={() =>
              run(async () => {
                await deleteBatch(batch.id);
                onClose();
              })
            }
          />
        )}
      </div>
      {batch.producerStatus === "done" && (
        <p className="text-xs text-secondary-500">
          To stage more instances into this batch or delete it, send it back to {made} first.
        </p>
      )}

      {sendingOne && (
        <Dialog title="Send back" onClose={() => setSendingOne(null)}>
          <p className="text-sm text-secondary-500">
            Send {sendingOne.label} back to To Do at {made}, to be made again? It leaves this batch,
            which keeps a record of it. The rest of the batch carries on.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                const { id, label } = sendingOne;
                setSendingOne(null);
                run(async () => {
                  await sendInstanceBack(batch.id, id);
                  setNotice(`${label} is back at ${made}, To Do.`);
                });
              }}
            >
              Send back
            </Button>
            <Button variant="secondary" onClick={() => setSendingOne(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}

      {sendingBack && (
        <SendBatchBackDialog
          batch={batch}
          processName={processName}
          run={run}
          onClose={() => setSendingBack(false)}
        />
      )}
    </Sheet>
  );
}

/** The batch's name, with Rename beside it; the status badge (`children`) goes under it. */
function BatchTitle({
  batch,
  busy,
  run,
  children,
}: {
  batch: Batch;
  busy: boolean;
  run: (action: () => Promise<unknown>) => void;
  children: React.ReactNode;
}) {
  // The name being typed, while it's being renamed.
  const [draft, setDraft] = useState<string | null>(null);
  const save = (name: string | null) => {
    setDraft(null);
    run(() => renameBatch(batch.id, name));
  };

  if (draft !== null) {
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <TextField
          kind="title"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Batch name"
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          {batch.name !== null && (
            <Button variant="secondary" size="sm" onClick={() => save(null)}>
              Use the automatic name
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 break-words text-3xl text-secondary-900">{batch.label}</h2>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setDraft(batch.label)}>
          Rename
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {children}
        {batch.label !== `Batch ${batch.number}` && (
          <span className="font-mono text-sm text-secondary-500">Batch {batch.number}</span>
        )}
      </div>
    </>
  );
}

/**
 * What to do with the batch next, in a sentence, with the buttons that do it (`children`): the one
 * place on the view that always says where things stand.
 */
function NextStep({
  batch,
  arrival,
  processName,
  whereOf,
  children,
}: {
  batch: Batch;
  arrival: ReturnType<typeof batchArrival>;
  processName: (id: number) => string;
  whereOf: (row: InstanceRow) => string;
  children: React.ReactNode;
}) {
  const stage = batchStage(batch);
  const here = stage.processId === null ? "its process" : processName(stage.processId);
  const members = batchMembers(batch).length;
  const waiting = arrival.live.filter((r) => !arrival.here.includes(r));

  let text: React.ReactNode;
  if (batchComplete(batch)) {
    text = "Complete. Its instances have moved on to their next processes.";
  } else if (stage.at === "producer") {
    if (members === 0) {
      text = `Nothing is in this batch yet. Stage instances into it at ${here}.`;
    } else if (stage.status === "todo") {
      text = batch.file
        ? `Ready to start at ${here}. Instances can still be staged or unstaged.`
        : `Ready to start at ${here}. Upload its file below when it's made, or go ahead without one.`;
    } else {
      text = `In progress at ${here}. Mark it complete when its file is ready${
        batch.file ? "" : " (none is uploaded yet)"
      }.`;
    }
  } else if (arrival.live.length === 0) {
    text = "No instances are left in this batch.";
  } else if (!arrival.all) {
    text = (
      <>
        {arrival.here.length} of {arrival.live.length} instances have reached {here}. The batch
        starts there once they all have. Still on the way:{" "}
        {waiting
          .slice(0, 6)
          .map((r) => `${r.definition.name} #${r.instance.instanceNumber} (${whereOf(r)})`)
          .join(", ")}
        {waiting.length > 6 ? "…" : ""}.
      </>
    );
  } else if (stage.status === "todo") {
    text = `Ready to start at ${here}.`;
  } else {
    text = `In progress at ${here}. Send back any instance that failed, then mark the rest complete.`;
  }

  return (
    <div className="space-y-3 rounded-xl border border-secondary-200 bg-inset p-4">
      <p className="text-sm text-secondary-900">{text}</p>
      <div className="flex flex-wrap items-start gap-2 empty:hidden">{children}</div>
    </div>
  );
}

/** One part's instances in the batch, then the ones that were sent back out of it. */
function PartInstances({
  definition,
  instances,
  rowById,
  whereOf,
  resolveName,
  action,
}: {
  definition: PartDefinition | undefined;
  instances: BatchInstance[];
  rowById: Map<number, InstanceRow>;
  whereOf: (row: InstanceRow) => string;
  resolveName: (id: string | null | undefined) => string;
  action: (instance: BatchInstance, label: string) => React.ReactNode;
}) {
  const name = definition?.name || definition?.onshapePartNumber || "Part";
  const inBatch = instances.filter((i) => i.removedAt === null).length;
  return (
    <div>
      <p className="text-sm font-semibold text-secondary-900">
        {definition ? <PartNameLink definition={definition} /> : name}{" "}
        <span className="font-normal text-secondary-400">× {inBatch}</span>
      </p>
      {definition && (
        <p className="text-xs font-mono text-secondary-400">{partLabelOf(definition)}</p>
      )}
      <ul className="mt-1.5 divide-y divide-secondary-200 border-y border-secondary-200">
        {instances.map((instance) => {
          const row = rowById.get(instance.partInstanceId);
          const label = `${name} #${instance.instanceNumber}`;
          const gone = instance.removedAt !== null;
          const title = (
            <>
              {name}
              <span className="ml-1.5 font-normal text-secondary-400">
                #{instance.instanceNumber}
              </span>
            </>
          );
          return (
            <li
              key={`${instance.partInstanceId}-${instance.removedAt ?? "in"}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2"
            >
              <span className={`text-sm font-medium ${gone ? "line-through" : ""}`}>
                {row ? (
                  <InstanceLink instanceId={instance.partInstanceId}>{title}</InstanceLink>
                ) : (
                  <span className="text-secondary-500">{title}</span>
                )}
              </span>
              {row?.instance.isPriority && !gone ? <PriorityTag /> : null}
              {row?.instance.isStale || definition?.isObsolete ? <Badge>Obsolete</Badge> : null}
              <span className="min-w-0 flex-1 text-xs text-secondary-500">
                {gone && instance.removedAt !== null && (
                  <span className="font-semibold text-amber-700">
                    Sent back {formatDay(instance.removedAt)}
                    {instance.removedBy === "migration"
                      ? ""
                      : ` by ${resolveName(instance.removedBy)}`}
                    .{" "}
                  </span>
                )}
                {row ? `${gone ? "Now " : ""}${whereOf(row)}` : ""}
              </span>
              {!gone && !row?.instance.isStale && action(instance, label)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The processes one part's instances go through, as a part's own Status shows them: done ones
 * struck out, the one they're at filled in (with how many, when they aren't all at the same one).
 */
function PartFlow({
  rows,
  processName,
  onNavigate,
}: {
  rows: InstanceRow[];
  processName: (id: number) => string;
  onNavigate: () => void;
}) {
  const [first] = rows;
  const complete = rows.filter((r) => r.state === "complete").length;
  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {first.procs.map((step, i) => {
        const at = rows.filter((r) => r.current?.index === step.index).length;
        const done = rows.every(
          (r) => r.procs.find((p) => p.index === step.index)?.status === "done",
        );
        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && <span className="mx-1 h-px w-4 bg-secondary-300" />}
            <Link
              to={processPath(step.processId)}
              onClick={onNavigate}
              title={`Go to ${processName(step.processId)} on the shop floor`}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors hover:border-secondary-400 ${
                at > 0
                  ? "border-primary-500 bg-primary-500 text-on-primary hover:bg-primary-600"
                  : done
                    ? "border-secondary-200 bg-page text-secondary-400 line-through"
                    : "border-secondary-300 bg-surface text-secondary-900"
              }`}
            >
              {processName(step.processId)}
              {at > 0 && at < rows.length ? ` · ${at}` : ""}
            </Link>
          </div>
        );
      })}
      {complete > 0 && (
        <span className="ml-2 text-xs font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 border-emerald-300 text-emerald-700">
          Complete{complete < rows.length ? ` · ${complete}` : ""}
        </span>
      )}
    </div>
  );
}
