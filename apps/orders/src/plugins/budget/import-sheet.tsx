import type { ImportSummary } from "@g3/worker-orders";
import { useRef, useState } from "react";
import { getErrorMessage } from "../../shared/api";
import { formatCents } from "../../shared/format";
import { Button, Card, ErrorBanner, SuccessBanner } from "../../shared/ui";

const ACTIONS: Record<ImportSummary["categories"][number]["action"], string> = {
  existing: "",
  "set code": " (will set its code)",
  create: " (new category)",
};

async function upload(text: string, dryRun: boolean): Promise<ImportSummary> {
  // Same base as the API client. Not `$url()`: that needs an absolute base, and dev uses "/api".
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/orders/import${dryRun ? "?dryRun=1" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    body: text,
    credentials: "include",
    headers: { "Content-Type": "text/csv" },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

/**
 * Imports the team's order sheet (.csv) so past orders and spending show up. Shows what would be
 * imported first; rows imported before are skipped, so it's safe to import a newer copy again.
 */
export function ImportSheet({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const text = await f.text();
      setFile({ name: f.name, text });
      setPreview(await upload(text, true));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await upload(file.text, false);
      setDone(
        `Imported ${result.orders} orders (${result.lines} items, ${formatCents(result.spentCents)}) and ${result.notOrdered} items not ordered yet.`,
      );
      setPreview(null);
      setFile(null);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const nothingNew = preview && preview.orders === 0 && preview.notOrdered === 0;

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy && !preview ? "Reading…" : "Import order sheet"}
      </Button>
      {done && <SuccessBanner message={done} />}
      {error && <ErrorBanner message={error} />}
      {preview && file && (
        <Card title={`Import ${file.name}`}>
          {nothingNew ? (
            <p className="text-sm text-secondary-600">
              Everything in this file has already been imported ({preview.alreadyImported} rows).
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-secondary-800">
                <span className="font-semibold">{preview.orders}</span> placed orders with{" "}
                <span className="font-semibold">{preview.lines}</span> items totaling{" "}
                <span className="font-semibold">{formatCents(preview.spentCents)}</span> (incl.
                shipping, tax and tariffs), plus{" "}
                <span className="font-semibold">{preview.notOrdered}</span> approved items not
                ordered yet.
                {preview.alreadyImported > 0 &&
                  ` ${preview.alreadyImported} rows were imported before and will be skipped.`}
              </p>
              <ul className="space-y-0.5">
                {preview.categories.map((c) => (
                  <li key={c.label} className="tabular-nums text-secondary-700">
                    <span className="font-mono text-xs text-secondary-500 mr-2">{c.label}</span>
                    {c.name}
                    {ACTIONS[c.action]}: {formatCents(c.cents)} spent
                  </li>
                ))}
              </ul>
              {preview.warnings.length > 0 && (
                <details className="text-xs text-secondary-500">
                  <summary className="cursor-pointer">{preview.warnings.length} notes</summary>
                  <ul className="mt-1 space-y-0.5">
                    {preview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {!nothingNew && (
              <Button disabled={busy} onClick={confirm}>
                {busy ? "Importing…" : "Import"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
            >
              {nothingNew ? "Close" : "Cancel"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
