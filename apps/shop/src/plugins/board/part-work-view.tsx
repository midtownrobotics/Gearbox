import { Button, Dialog } from "@g3/ui";
import { useState } from "react";

import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import type { InstanceRow } from "../../shared/derive";
import type { ShopData } from "../../shared/use-shop-data";
import { ShopView, shopButton, shopButtonPlain } from "./shop-view";

/** The shop view of a part that's being worked on: send it back, or mark it complete. */
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
      <button
        type="button"
        onClick={onMarkComplete}
        disabled={busy}
        // On its own row under the others when the panel is under the drawing.
        className={`${shopButton} col-span-full bg-emerald-600 text-white hover:bg-emerald-700`}
      >
        Mark complete
      </button>

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
                  <span className="text-sm text-secondary-900 capitalize">{s}</span>
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
