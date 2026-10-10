import { useState } from "react";
import type { InstanceRow } from "../../shared/derive";
import type { ShopData } from "../../shared/use-shop-data";
import { ShopView, shopButton, shopButtonPlain } from "./shop-view";

/** The shop view of a part that's waiting at this machine: look at it, then start it. */
export function PartDetailsView({
  row,
  data,
  onClose,
  onStartPart,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  onStartPart: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

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
      <button
        type="button"
        onClick={handleStartPart}
        disabled={busy}
        className={`${shopButton} bg-crimson text-paper hover:bg-crimson-dark`}
      >
        Start Part
      </button>
    </ShopView>
  );
}
