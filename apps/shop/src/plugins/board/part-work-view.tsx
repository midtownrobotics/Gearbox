import { useState } from "react";

import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import type { InstanceRow } from "../../shared/derive";
import { PrintDrawingButton } from "../../shared/print-drawing-button";
import type { ShopData } from "../../shared/use-shop-data";
import { DrawingPreview } from "../parts/drawing-preview";

export function PartWorkView({
  row,
  data,
  onClose,
  onMarkComplete,
  onChanged,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  onMarkComplete: () => Promise<void>;
  onChanged?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertStatus, setRevertStatus] = useState<"todo" | "doing">("todo");
  const subsystem = data.subsystems.find((s) => s.id === row.definition.subsystemId);
  const currentProcess = row.current;

  async function handleRevert() {
    if (!currentProcess) return;
    setBusy(true);
    const res = await api["part-instance-processes"][":partInstanceId"].processes[
      ":processId"
    ].$patch({
      param: {
        partInstanceId: String(row.instance.id),
        processId: String(currentProcess.processId),
      },
      json: { status: revertStatus },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setBusy(false);
      return;
    }
    setBanner(null);
    setShowRevertModal(false);
    await onChanged?.();
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 bg-paper z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-steel/30">
        <h1 className="font-display text-3xl text-ink">
          {row.definition.name}
          <span className="text-steel font-normal ml-2">#{row.instance.instanceNumber}</span>
        </h1>
        <button
          type="button"
          onClick={onClose}
          className="text-3xl text-steel hover:text-ink transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Error banner */}
      {banner && (
        <div className="px-6 py-3 bg-crimson-tint border-b border-crimson/30">
          <p className="text-sm text-crimson-dark">{banner}</p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Drawing PDF - 3/4 width */}
        <div className="flex-1 border-r border-steel/30 bg-surface flex">
          <DrawingPreview
            partNumber={row.definition.onshapePartNumber}
            revision={row.definition.revision}
            hideOverlay
            fullHeight
          />
        </div>

        {/* Part info - 1/4 width */}
        <div className="w-1/4 flex flex-col p-6 overflow-y-auto">
          <div className="space-y-5 flex-1">
            <div>
              <p className="text-sm font-semibold text-steel mb-2">Name</p>
              <p className="text-base text-ink">{row.definition.name || "—"}</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-steel mb-2">Part Number</p>
              <p className="text-base font-mono text-ink">{row.definition.onshapePartNumber}</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-steel mb-2">Revision</p>
              <p className="text-base text-ink">{row.definition.revision || "—"}</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-steel mb-2">Instance</p>
              <p className="text-base text-ink">#{row.instance.instanceNumber}</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-steel mb-2">Subsystem</p>
              <p className="text-base text-ink">{subsystem?.name || "—"}</p>
            </div>

            {row.definition.notes && (
              <div>
                <p className="text-sm font-semibold text-steel mb-2">Notes</p>
                <p className="text-base text-ink whitespace-pre-wrap">{row.definition.notes}</p>
              </div>
            )}

            {row.instance.isPriority ? (
              <div className="pt-2">
                <span className="inline-block text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded">
                  Priority
                </span>
              </div>
            ) : null}
          </div>

          {/* Buttons */}
          <div className="space-y-3 pt-6 border-t border-steel/30 mt-6">
            <PrintDrawingButton
              partNumber={row.definition.onshapePartNumber}
              revision={row.definition.revision}
              size="kiosk"
            />
            <button
              type="button"
              onClick={onClose}
              className="w-full px-6 py-4 text-lg font-semibold text-steel-dark bg-steel-tint border border-steel/30 hover:bg-steel/20 hover:border-steel/50 active:bg-steel/30 rounded-lg transition-colors"
            >
              Exit
            </button>
            {currentProcess && row.state !== "complete" && (
              <button
                type="button"
                onClick={async () => {
                  if (row.state === "doing") {
                    setBusy(true);
                    const res = await api["part-instance-processes"][":partInstanceId"].processes[
                      ":processId"
                    ].$patch({
                      param: {
                        partInstanceId: String(row.instance.id),
                        processId: String(currentProcess.processId),
                      },
                      json: { status: "todo" },
                    });
                    if (!res.ok) {
                      setBanner(await getErrorMessage(res as unknown as Response));
                      setBusy(false);
                      return;
                    }
                    setBanner(null);
                    await onChanged?.();
                    setBusy(false);
                    onClose();
                  } else {
                    setRevertStatus("doing");
                    setShowRevertModal(true);
                  }
                }}
                disabled={busy}
                className="w-full px-6 py-4 text-lg font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
              >
                ↶ Send Back
              </button>
            )}
            <button
              type="button"
              onClick={onMarkComplete}
              disabled={busy}
              className="w-full px-6 py-4 text-lg font-semibold text-paper bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
            >
              Mark Complete
            </button>
          </div>

          {/* Revert Modal */}
          {showRevertModal && (
            <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
              <div className="bg-paper rounded-lg shadow-lg max-w-sm w-full p-6 space-y-4">
                <h3 className="text-lg font-bold text-ink">Send Back</h3>
                <p className="text-sm text-steel">Move this part back to which status?</p>

                <div className="space-y-2">
                  {(["todo", "doing"] as const).map((s) => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="revert-status"
                        value={s}
                        checked={revertStatus === s}
                        onChange={() => setRevertStatus(s)}
                        className="accent-amber-500"
                      />
                      <span className="text-sm text-ink capitalize">{s}</span>
                    </label>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowRevertModal(false)}
                    disabled={busy}
                    className="flex-1 py-2 rounded-lg border border-steel/50 text-steel-dark hover:bg-steel-tint text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevert()}
                    disabled={busy}
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
