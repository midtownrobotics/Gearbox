import { useState } from "react";
import type { InstanceRow } from "../../shared/derive";
import { useCanQualityCheck } from "../../shared/use-auth";
import type { ShopData } from "../../shared/use-shop-data";
import { ShopView, shopButton, shopButtonPlain } from "./shop-view";

/** The shop view of a part that's waiting at this machine: look at it, then start it. */
export function PartDetailsView({
  row,
  data,
  onClose,
  onStartPart,
  onStartReport,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  onStartPart: () => Promise<void>;
  /** Given at a Quality Control step finished with a report: shown in place of Start Part. */
  onStartReport?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const canQualityCheck = useCanQualityCheck();

  async function handleStartPart() {
    setBusy(true);
    try {
      await onStartPart();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ShopView row={row} data={data} onClose={onClose}>
      <button type="button" onClick={onClose} className={shopButtonPlain}>
        Close
      </button>
      {onStartReport ? (
        <button
          type="button"
          onClick={onStartReport}
          disabled={!canQualityCheck}
          title={canQualityCheck ? undefined : "Only a shop manager can do a quality report."}
          className={`${shopButton} bg-crimson text-paper hover:bg-crimson-dark disabled:bg-steel/40 disabled:cursor-not-allowed`}
        >
          {canQualityCheck ? "Start Quality Report" : "Needs a shop manager"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStartPart}
          disabled={busy}
          className={`${shopButton} bg-crimson text-paper hover:bg-crimson-dark`}
        >
          Start Part
        </button>
      )}
    </ShopView>
  );
}
