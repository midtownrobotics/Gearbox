import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import type { InstanceRow } from "../../shared/derive";
import { processPath, shopViewPath } from "../../shared/nav";
import { PrintDrawingButton } from "../../shared/print-drawing-button";
import type { ShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";
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
  const [banner, setBanner] = useState<string | null>(null);
  const [addInstanceFeedback, setAddInstanceFeedback] = useState<"success" | "error" | null>(null);
  const [addInstanceError, setAddInstanceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSendBackModal, setShowSendBackModal] = useState(false);
  const [sendBackProcess, setSendBackProcess] = useState<number | null>(null);
  const [sendBackStatus, setSendBackStatus] = useState<"todo" | "doing" | "done">("todo");

  const isObsolete = !!row.instance.isStale;
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
    if (!window.confirm("Mark this part as obsolete? It will move to the Obsolete table.")) return;
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
    <div className="fixed inset-0 z-50 bg-paper overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        {/* Above the page's own layers (the drawing is one), so nothing shows over it. */}
        <div className="sticky top-0 z-10 bg-paper border-b border-steel/20 flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-3xl text-ink truncate">
              {row.definition.name}{" "}
              <span className="text-steel text-2xl">
                #{activePosition} of {totalInstances}
              </span>
            </h2>
            <p className="text-sm text-steel-dark font-mono">
              {row.definition.onshapePartNumber} · Rev {row.definition.revision}
            </p>
            {isObsolete && (
              <span className="inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-steel-dark bg-steel-tint border border-steel/40 rounded-full px-2 py-0.5">
                Obsolete · view only
              </span>
            )}
            {row.current && !isObsolete && (
              <Link
                to={shopViewPath(row.current.processId, row.instance.id)}
                onClick={onClose}
                className="mt-2 inline-flex rounded-lg border border-steel/30 bg-steel-tint px-3 py-1.5 text-sm font-semibold text-steel-dark transition-colors hover:border-steel/50 hover:bg-steel/20"
              >
                Switch to Shop View
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-steel hover:text-ink text-3xl leading-none p-2 shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pb-8 pt-4 space-y-4">
          {banner && (
            <p className="text-crimson-dark text-sm bg-crimson-tint border border-crimson/30 rounded-lg px-3 py-2">
              {banner}
            </p>
          )}

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
              <dt className="text-steel">Priority</dt>
              <dd>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!row.instance.isPriority}
                    disabled={busy || isObsolete}
                    onChange={(e) => setPriority(e.target.checked)}
                    className="accent-crimson w-4 h-4 disabled:opacity-50"
                  />
                  <span className="text-ink">Priority</span>
                </label>
              </dd>
            </dl>
          </Section>

          {/* An obsolete part is only looked at: no files to assign, nothing to change. */}
          {!isObsolete && (
            <Section title="Files">
              <PartFilesPanel
                definition={row.definition}
                definitions={data.definitions}
                instances={data.instances}
                currentInstanceId={row.instance.id}
              />
            </Section>
          )}

          {/* Status */}
          <Section title="Status">
            {row.procs.length === 0 ? (
              <p className="text-sm text-steel">
                No processes — the blueprint was empty when this instance was made.
              </p>
            ) : (
              <div className="flex items-center flex-wrap gap-y-2">
                {row.procs.map((proc, i) => {
                  const isDone = proc.status === "done";
                  const isCurrent = row.current?.id === proc.id;
                  return (
                    <div key={proc.id} className="flex items-center">
                      {i > 0 && <span className="w-4 h-px bg-steel/40 mx-1" />}
                      <Link
                        to={processPath(proc.processId)}
                        title={`Go to ${processName(proc.processId)} on the shop floor`}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors hover:border-crimson ${
                          isCurrent
                            ? "bg-crimson border-crimson text-paper hover:bg-crimson-dark"
                            : isDone
                              ? "bg-mist border-steel/30 text-steel/70 line-through"
                              : "bg-paper border-steel/50 text-ink"
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
              <p className="text-xs text-steel-dark mt-2">
                Currently {row.state === "doing" ? "in progress" : "queued"} at{" "}
                <Link
                  to={processPath(row.current.processId)}
                  className="font-semibold text-ink hover:text-crimson underline transition-colors"
                >
                  {processName(row.current.processId)}
                </Link>
                .
              </p>
            )}
          </Section>

          {addInstanceFeedback && (
            <p
              className={`text-sm rounded-lg px-3 py-2 border text-center ${
                addInstanceFeedback === "success"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-crimson-tint text-crimson-dark border-crimson/30"
              }`}
            >
              {addInstanceFeedback === "success"
                ? "✓ Part instance added successfully"
                : addInstanceError}
            </p>
          )}

          {!isObsolete && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={addMoreInstances}
                disabled={busy}
                className="w-full py-2.5 rounded-lg border border-emerald-400/50 text-emerald-700 hover:bg-emerald-50 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                + Add One
              </button>
              <button
                type="button"
                onClick={() => {
                  setSendBackProcess(row.procs[0]?.processId ?? null);
                  setSendBackStatus("todo");
                  setShowSendBackModal(true);
                }}
                disabled={busy}
                className="w-full py-2.5 rounded-lg border border-amber-400/50 text-amber-700 hover:bg-amber-50 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                ↶ Send Back
              </button>
              <button
                type="button"
                onClick={transferProcesses}
                disabled={busy}
                className="w-full py-2.5 rounded-lg border border-steel/50 text-steel-dark hover:bg-steel-tint text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Edit & Obsolete
              </button>
              <button
                type="button"
                onClick={makeObsolete}
                disabled={busy}
                className="w-full py-2.5 rounded-lg border border-crimson/50 text-crimson hover:bg-crimson-tint text-sm font-semibold transition-colors disabled:opacity-50 sm:col-span-3"
              >
                Make Obsolete
              </button>
            </div>
          )}

          {/* Send Back Modal */}
          {showSendBackModal && (
            <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
              <div className="bg-paper rounded-lg shadow-lg max-w-sm w-full p-6 space-y-4">
                <h3 className="text-lg font-bold text-ink">Send Part Back</h3>

                <div>
                  <label
                    htmlFor="send-back-process"
                    className="block text-sm font-semibold text-steel mb-2"
                  >
                    Process
                  </label>
                  <select
                    id="send-back-process"
                    value={sendBackProcess ?? ""}
                    onChange={(e) => setSendBackProcess(Number(e.target.value) || null)}
                    className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
                  >
                    <option value="">Select a process...</option>
                    {row.procs.map((proc) => (
                      <option key={proc.id} value={proc.processId}>
                        {processName(proc.processId)}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset>
                  <legend className="block text-sm font-semibold text-steel mb-2">Status</legend>
                  <div className="space-y-2">
                    {(["todo", "doing", "done"] as const).map((s) => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="status"
                          value={s}
                          checked={sendBackStatus === s}
                          onChange={() => setSendBackStatus(s)}
                          className="accent-crimson"
                        />
                        <span className="text-sm text-ink capitalize">{s}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSendBackModal(false)}
                    disabled={busy}
                    className="flex-1 py-2 rounded-lg border border-steel/50 text-steel-dark hover:bg-steel-tint text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={sendBack}
                    disabled={busy || !sendBackProcess}
                    className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    Send Back
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border border-steel/25 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm font-bold uppercase tracking-wider text-steel-dark">{title}</span>
        <span className={`text-steel text-xs transition-transform ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-steel">{label}</dt>
      <dd className={`text-ink break-words ${mono ? "font-mono" : ""}`}>{value}</dd>
    </>
  );
}
