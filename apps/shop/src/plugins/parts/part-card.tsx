import {
  Button,
  ConfirmButton,
  Dialog,
  ErrorBanner,
  Field,
  SuccessBanner,
  buttonClass,
  inputClass,
} from "@g3/ui";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { batchAt, batchesById, currentBatch } from "../../shared/batches";
import { type InstanceRow, STATUS_LABELS } from "../../shared/derive";
import { processPath, shopViewPath } from "../../shared/nav";
import { onshapeLinkFor, useOnshapeLinks } from "../../shared/onshape-links";
import { OnshapePartLinks } from "../../shared/onshape-part-links";
import { PrintDrawingButton } from "../../shared/print-drawing-button";
import type { ShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";
import { BatchLink, linkClass } from "../batches/batch-ui";
import { PartFilesPanel } from "../files/part-files-panel";
import { DrawingPreview } from "./drawing-preview";

/** Advance a revision by one for convenience (A→B, Z→AA, 1→2). */
export function advanceRevision(rev: string): string {
  const r = rev.trim();
  if (!r) return "A";
  if (/^[A-Za-z]+$/.test(r)) {
    const isUpper = r === r.toUpperCase();
    const arr = r.toUpperCase().split("");
    let i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === "Z") {
        arr[i] = "A";
        i--;
      } else {
        arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1);
        break;
      }
    }
    if (i < 0) arr.unshift("A");
    const out = arr.join("");
    return isUpper ? out : out.toLowerCase();
  }
  if (/^\d+$/.test(r)) return String(Number(r) + 1);
  return r;
}

export function PartCard({
  row,
  data,
  onClose,
  onChanged,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const onshapeLinks = useOnshapeLinks();
  const [banner, setBanner] = useState<string | null>(null);
  const [addInstanceFeedback, setAddInstanceFeedback] = useState<"success" | "error" | null>(null);
  const [addInstanceError, setAddInstanceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSendBackModal, setShowSendBackModal] = useState(false);
  const [sendBackProcess, setSendBackProcess] = useState<number | null>(null);
  const [sendBackStatus, setSendBackStatus] = useState<"todo" | "doing" | "done">("todo");

  const isObsolete = !!row.instance.isStale;
  // A step its batch moves can't be moved from here: the batch's own view does that.
  const batchById = batchesById(data.batches);
  const inBatch = currentBatch(row, batchById);
  const sendBackBatch = sendBackProcess === null ? null : batchAt(row, sendBackProcess, batchById);
  const resolveName = useUserNames(
    [row.definition.creator, row.instance.obsoletedBy].filter((id): id is string => !!id),
  );

  const processName = (pid: number) =>
    data.processes.find((p) => p.id === pid)?.name ?? `Process #${pid}`;
  const subsystemName =
    data.subsystems.find((s) => s.id === row.definition.subsystemId)?.name ?? "—";
  // For display, re-index active instances so numbering starts at 1 for each edit cycle
  const activeInstances = data.instances
    .filter((i) => i.partDefinitionId === row.definition.id && i.isStale === 0)
    .sort((a, b) => a.instanceNumber - b.instanceNumber);
  const activePosition = activeInstances.findIndex((i) => i.id === row.instance.id) + 1;
  const totalInstances = activeInstances.length;

  async function setPriority(next: boolean) {
    setBusy(true);
    const res = await api["part-instances"][":id"].$patch({
      param: { id: String(row.instance.id) },
      json: { isPriority: next },
    });
    if (!res.ok) setBanner(await getErrorMessage(res as unknown as Response));
    else {
      setBanner(null);
      await onChanged();
    }
    setBusy(false);
  }

  async function makeObsolete() {
    setBusy(true);
    const res = await api["part-instances"][":id"].$patch({
      param: { id: String(row.instance.id) },
      json: { isStale: true },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setBusy(false);
      return;
    }
    await onChanged();
    onClose();
  }

  async function addMoreInstances() {
    setBusy(true);
    const res = await api["part-instances"].$post({
      json: { partDefinitionId: row.definition.id, quantity: 1 },
    });
    if (!res.ok) {
      const error = await getErrorMessage(res as unknown as Response);
      setAddInstanceError(error);
      setAddInstanceFeedback("error");
      setTimeout(() => setAddInstanceFeedback(null), 5000);
    } else {
      setAddInstanceFeedback("success");
      await onChanged();
      setTimeout(() => setAddInstanceFeedback(null), 3000);
    }
    setBusy(false);
  }

  async function sendBack() {
    if (!sendBackProcess) return;
    setBusy(true);
    const res = await api["part-instance-processes"][":partInstanceId"].processes[
      ":processId"
    ].$patch({
      param: {
        partInstanceId: String(row.instance.id),
        processId: String(sendBackProcess),
      },
      json: { status: sendBackStatus },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setBusy(false);
      return;
    }
    setBanner(null);
    setShowSendBackModal(false);
    await onChanged();
    setBusy(false);
  }

  /** Open the Edit & Obsolete page to create a new version of this part. */
  function transferProcesses() {
    navigate("/parts/new", {
      state: {
        transferFrom: {
          sourcePartDefinitionId: row.definition.id,
          onshapePartNumber: row.definition.onshapePartNumber,
          revision: row.definition.revision,
          subsystemId: row.definition.subsystemId,
          name: row.definition.name,
          notes: row.definition.notes ?? "",
          material: row.definition.material ?? "",
          thickness: row.definition.thickness ?? "",
          isPriority: !!row.instance.isPriority,
          quantity: totalInstances,
          // Pipeline in order, flagged with whether each step was already done.
          processes: row.procs.map((p) => ({
            processId: p.processId,
            done: p.status === "done",
          })),
        },
      },
    });
  }

  return (
    // Full-screen takeover — close via the X button in the corner.
    <div className="fixed inset-0 z-50 bg-surface overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        {/* Above the page's own layers (the drawing is one), so nothing shows over it. */}
        <div className="sticky top-0 z-10 bg-surface border-b border-secondary-200 flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-3xl text-secondary-900 truncate" title={row.definition.name}>
              {row.definition.name}{" "}
              <span className="text-secondary-400 text-2xl">
                #{activePosition} of {totalInstances}
              </span>
            </h2>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <p className="text-secondary-500 font-mono break-words min-w-0">
                {row.definition.onshapePartNumber} · Rev {row.definition.revision}
              </p>
              <OnshapePartLinks
                link={onshapeLinkFor(
                  onshapeLinks,
                  row.definition.onshapePartNumber,
                  row.definition.revision,
                )}
              />
            </div>
            {isObsolete && (
              <span className="inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-secondary-500 bg-inset border border-secondary-300 rounded-full px-2 py-0.5">
                Obsolete · view only
              </span>
            )}
            {row.current && !isObsolete && !inBatch && (
              <Link
                to={shopViewPath(row.current.processId, row.instance.id)}
                onClick={onClose}
                className={`${buttonClass("secondary", "sm")} mt-2`}
              >
                Switch to shop view
              </Link>
            )}
            {inBatch && !isObsolete && (
              <p className="mt-2 text-sm text-secondary-500">
                Moves with its batch, <BatchLink batch={inBatch} />.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-secondary-400 hover:text-secondary-900 text-3xl leading-none p-2 shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pb-8 pt-4 space-y-4">
          {banner && <ErrorBanner message={banner} />}

          {/* The released drawing, when R2 has one for this revision. */}
          <div className="space-y-2">
            <DrawingPreview
              partNumber={row.definition.onshapePartNumber}
              revision={row.definition.revision}
            />
            <div className="flex justify-end">
              <PrintDrawingButton
                partNumber={row.definition.onshapePartNumber}
                revision={row.definition.revision}
              />
            </div>
          </div>

          {/* Information */}
          <Section title="Information">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <Meta label="Name" value={row.definition.name} />
              <Meta label="Part Number" value={row.definition.onshapePartNumber} mono />
              <Meta label="Revision" value={row.definition.revision} mono />
              <Meta label="Instance" value={`#${activePosition} of ${totalInstances}`} mono />
              <Meta label="Subsystem" value={subsystemName} />
              <Meta label="Notes" value={row.definition.notes || "—"} />
              <Meta
                label="Created"
                value={new Date(row.definition.createdAt).toLocaleDateString()}
              />
              <Meta label="Created By" value={resolveName(row.definition.creator)} />
              {isObsolete && (
                <>
                  <Meta
                    label="Obsoleted"
                    value={
                      row.instance.obsoletedAt
                        ? new Date(row.instance.obsoletedAt).toLocaleDateString()
                        : "—"
                    }
                  />
                  <Meta
                    label="Obsoleted By"
                    value={row.instance.obsoletedBy ? resolveName(row.instance.obsoletedBy) : "—"}
                  />
                </>
              )}
              <dt className="text-secondary-400">Priority</dt>
              <dd>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!row.instance.isPriority}
                    disabled={busy || isObsolete}
                    onChange={(e) => setPriority(e.target.checked)}
                    className="accent-primary-500 w-4 h-4 disabled:opacity-50"
                  />
                  <span className="text-secondary-900">Priority</span>
                </label>
              </dd>
            </dl>
          </Section>

          {/* An obsolete part is only looked at: no files to assign, nothing to change. */}
          {!isObsolete && (
            <Section title="Files">
              <PartFilesPanel
                definition={row.definition}
                data={data}
                currentInstanceId={row.instance.id}
              />
            </Section>
          )}

          {/* Status */}
          <Section title="Status">
            {row.procs.length === 0 ? (
              <p className="text-sm text-secondary-400">
                No processes — the blueprint was empty when this instance was made.
              </p>
            ) : (
              <div className="flex items-center flex-wrap gap-y-2">
                {row.procs.map((proc, i) => {
                  const isDone = proc.status === "done";
                  const isCurrent = row.current?.id === proc.id;
                  return (
                    <div key={proc.id} className="flex items-center">
                      {i > 0 && <span className="w-4 h-px bg-secondary-300 mx-1" />}
                      <Link
                        to={processPath(proc.processId)}
                        title={`Go to ${processName(proc.processId)} on the shop floor`}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors hover:border-secondary-400 ${
                          isCurrent
                            ? "bg-primary-500 border-primary-500 text-on-primary hover:bg-primary-600"
                            : isDone
                              ? "bg-page border-secondary-200 text-secondary-400 line-through"
                              : "bg-surface border-secondary-300 text-secondary-900"
                        }`}
                      >
                        {processName(proc.processId)}
                      </Link>
                    </div>
                  );
                })}
                {row.state === "complete" && (
                  <span className="ml-2 text-xs font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 border-emerald-300 text-emerald-700">
                    Complete
                  </span>
                )}
              </div>
            )}
            {row.current && row.state === "doing" && (
              <p className="text-xs text-secondary-500 mt-2">
                Currently {row.state === "doing" ? "in progress" : "queued"} at{" "}
                <Link
                  to={processPath(row.current.processId)}
                  className="font-semibold text-secondary-900 hover:text-primary-600 underline transition-colors"
                >
                  {processName(row.current.processId)}
                </Link>
                .
              </p>
            )}
          </Section>

          {addInstanceFeedback === "success" && (
            <SuccessBanner message="Added one more instance of this part." />
          )}
          {addInstanceFeedback && addInstanceFeedback !== "success" && (
            <ErrorBanner message={addInstanceError ?? "Couldn't add an instance."} />
          )}

          {!isObsolete && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={addMoreInstances} disabled={busy}>
                Add one more
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setSendBackProcess(row.procs[0]?.processId ?? null);
                  setSendBackStatus("todo");
                  setShowSendBackModal(true);
                }}
                disabled={busy}
              >
                Send back
              </Button>
              <Button variant="secondary" onClick={transferProcesses} disabled={busy}>
                Edit and make obsolete
              </Button>
              <ConfirmButton
                label="Make obsolete"
                question="Make this part obsolete? It moves to the Obsolete table."
                disabled={busy}
                onConfirm={makeObsolete}
              />
            </div>
          )}

          {/* Send Back Modal */}
          {showSendBackModal && (
            <Dialog title="Send back" onClose={() => setShowSendBackModal(false)}>
              <>
                <Field label="Process">
                  <select
                    value={sendBackProcess ?? ""}
                    onChange={(e) => setSendBackProcess(Number(e.target.value) || null)}
                    className={inputClass}
                  >
                    <option value="">Select a process…</option>
                    {row.procs.map((proc) => (
                      <option key={proc.id} value={proc.processId}>
                        {processName(proc.processId)}
                        {batchAt(row, proc.processId, batchById) ? " (moves with its batch)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                {sendBackBatch && (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                    At {processName(sendBackBatch.processId)}
                    {sendBackBatch.consumerProcessId !== null &&
                      ` and ${processName(sendBackBatch.consumerProcessId)}`}{" "}
                    this part moves with its batch. Open{" "}
                    <BatchLink batch={sendBackBatch} className={linkClass} /> to send the part back
                    from it, or to send the whole batch back.
                  </p>
                )}

                <fieldset>
                  <legend className="mb-1 block text-sm font-medium text-secondary-700">
                    Status
                  </legend>
                  <div className="space-y-2">
                    {(["todo", "doing", "done"] as const).map((s) => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="status"
                          value={s}
                          checked={sendBackStatus === s}
                          onChange={() => setSendBackStatus(s)}
                          className="accent-primary-500"
                        />
                        <span className="text-sm text-secondary-900">{STATUS_LABELS[s]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={sendBack} disabled={busy || !sendBackProcess || !!sendBackBatch}>
                    Send back
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowSendBackModal(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
}

/** A panel of a part's or a batch's full-screen view, which opens and closes. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border border-secondary-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm font-bold uppercase tracking-wider text-secondary-500">
          {title}
        </span>
        <span
          className={`text-secondary-400 text-xs transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▼
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/** One labeled fact in such a panel's list. */
export function Meta({
  label,
  value,
  mono,
}: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-secondary-400">{label}</dt>
      <dd className={`text-secondary-900 break-words ${mono ? "font-mono" : ""}`}>{value}</dd>
    </>
  );
}
