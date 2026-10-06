import { useState } from "react";
import { api, getErrorMessage } from "./api";
import { Button } from "./ui";

/**
 * Downloads one fiscal year's purchasing spreadsheet (same columns as the team's order sheet).
 * Mentors only. Without `fiscalYear`, the current year.
 */
export function ExportCsvButton({ fiscalYear }: { fiscalYear?: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.orders["export.csv"].$get({
        query: fiscalYear === undefined ? {} : { fy: String(fiscalYear) },
      });
      if (!res.ok) throw new Error(await getErrorMessage(res));
      const name =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "g3-orders.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-primary-700">{error}</span>}
      <Button variant="secondary" onClick={download} disabled={busy}>
        {busy ? "Exporting…" : "Export CSV"}
      </Button>
    </div>
  );
}
