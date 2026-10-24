import { Button, Dialog } from "@g3/ui";
import { useState } from "react";

import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { type InstanceRow, STATUS_LABELS } from "../../shared/derive";
import { useCanQualityCheck } from "../../shared/use-auth";
import type { ShopData } from "../../shared/use-shop-data";
import { ShopView, shopButton, shopButtonPlain } from "./shop-view";

/** The shop view of a part that's being worked on: send it back, or mark it complete. */
export function PartWorkView({
  row,
  data,
  onClose,
  onMarkComplete,
  onStartReport,
  onChanged,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  onMarkComplete: () => Promise<void>;
  /** Given at a Quality Control step finished with a report: shown in place of Mark complete. */
  onStartReport?: () => void;
  onChanged?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertStatus, setRevertStatus] = useState<"todo" | "doing">("todo");
  const currentProcess = row.current;
  // A quality check is signed off by a shop manager or an admin only.
  const canQualityCheck = useCanQualityCheck();
  const isQualityCheck =
    data.processes.find((p) => p.id === currentProcess?.processId)?.type === "quality_control";
  const blocked = isQualityCheck && !canQualityCheck;

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
    <ShopView row={row} data={data} onClose={onClose} banner={banner}>
      <button type="button" onClick={onClose} className={shopButtonPlain}>
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
          className={`${shopButton} border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
        >
          Send back
        </button>
      )}
      {onStartReport ? (
        <button
          type="button"
          onClick={onStartReport}
          disabled={busy || blocked}
          title={blocked ? "Only a shop manager can do a quality report." : undefined}
          className={`${shopButton} col-span-full bg-primary-500 text-on-primary hover:bg-primary-600 disabled:cursor-not-allowed`}
        >
          {blocked ? "Needs a shop manager" : "Start quality report"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onMarkComplete}
          disabled={busy || blocked}
          title={blocked ? "Only a shop manager can mark a quality check complete." : undefined}
          // On its own row under the others when the panel is under the drawing.
          className={`${shopButton} col-span-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed`}
        >
          {blocked ? "Needs a shop manager" : "Mark complete"}
        </button>
      )}

      {showRevertModal && (
        <Dialog title="Send back" onClose={() => setShowRevertModal(false)}>
          <>
            <p className="text-sm text-secondary-500">Move this part back to which status?</p>

            <div className="space-y-2">
              {(["todo", "doing"] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="revert-status"
                    value={s}
                    checked={revertStatus === s}
                    onChange={() => setRevertStatus(s)}
                    className="accent-primary-500"
                  />
                  <span className="text-sm text-secondary-900">{STATUS_LABELS[s]}</span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleRevert()} disabled={busy}>
                Send back
              </Button>
              <Button variant="secondary" onClick={() => setShowRevertModal(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        </Dialog>
      )}
    </ShopView>
  );
}
