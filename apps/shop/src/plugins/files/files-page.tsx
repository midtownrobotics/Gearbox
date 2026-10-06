import { useTeamNames } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { buildInstanceRows } from "../../shared/derive";
import { deleteDrawing } from "../../shared/getters";
import { ErrorBanner, PageLoading } from "../../shared/ui";
import { useAuthUser } from "../../shared/use-auth";
import { useKiosk } from "../../shared/use-auth";
import { useShopData } from "../../shared/use-shop-data";
import { InProductionBadge, confirmDelete, formatBytes, productionRows } from "./part-files-panel";
import { PartFilesSection } from "./part-files-section";

type Drawing = {
  id: number;
  partNumber: string;
  revision: string;
  filename: string;
  r2Key: string;
  fileSize: number | null;
  uploadedBy: string | null;
  createdAt: number;
};

export function FilesPage() {
  const names = useTeamNames();
  const user = useAuthUser();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [search, setSearch] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const kiosk = useKiosk();
  const { data } = useShopData();
  const inProduction = useMemo(() => (data ? productionRows(buildInstanceRows(data)) : []), [data]);
  const drawingUsage = useMemo(() => {
    const map = new Map<string, typeof inProduction>();
    for (const r of inProduction) {
      const key = `${r.definition.onshapePartNumber}\u0000${r.definition.revision}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [inProduction]);
  const usageOfDrawing = (d: Drawing) =>
    drawingUsage.get(`${d.partNumber}\u0000${d.revision}`) ?? [];

  async function handleDeleteDrawing(drawing: Drawing) {
    if (
      !confirmDelete(
        `the drawing for ${drawing.partNumber} Rev ${drawing.revision}`,
        usageOfDrawing(drawing),
      )
    ) {
      return;
    }
    setDeletingKey(drawing.r2Key);
    try {
      await deleteDrawing(drawing.partNumber, drawing.revision);
      setDrawings((prev) => prev.filter((d) => d.r2Key !== drawing.r2Key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete drawing");
    } finally {
      setDeletingKey(null);
    }
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [testPrinting, setTestPrinting] = useState(false);

  useEffect(() => {
    loadDrawings();
  }, []);

  async function loadDrawings() {
    try {
      setLoading(true);
      setError(null);
      const res = await api.drawings.$get();
      if (!res.ok) {
        setError(await getErrorMessage(res as unknown as Response));
        return;
      }
      const data = (await res.json()) as { drawings: Drawing[] };
      setDrawings(data.drawings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drawings");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrint(drawing: Drawing) {
    setPrintingId(drawing.id);
    try {
      // The worker prints the stored drawing directly, so the PDF isn't
      // downloaded here and uploaded back over the shop's hotspot.
      const printRes = await api.print.drawing[":partNumber"][":revision"].$post({
        param: { partNumber: drawing.partNumber, revision: drawing.revision },
      });
      const printData = (await printRes.json()) as {
        ok: boolean;
        jobId?: string;
        error?: string;
        warning?: string | null;
      };
      if (!printData.ok) {
        setError(`Print failed: ${printData.error}`);
        return;
      }

      // Queued; mention a printer problem (out of paper, jam, ...) if there is one.
      if (printData.warning) setError(printData.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to print drawing");
    } finally {
      setPrintingId(null);
    }
  }

  async function handleTestPrint() {
    setTestPrinting(true);
    try {
      const testContent = `${names.name} Shop - Test Print\n\nIf you're seeing this, the printer is working!`;
      const encoder = new TextEncoder();
      const testBuffer = encoder.encode(testContent);

      const printRes = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/print?title=test-print`,
        {
          method: "POST",
          headers: {
            "content-type": "text/plain",
          },
          body: testBuffer,
          credentials: "include",
        },
      );

      const printData = (await printRes.json()) as {
        ok: boolean;
        jobId?: string;
        error?: string;
        warning?: string | null;
      };
      if (!printData.ok) {
        setError(`Test print failed: ${printData.error}`);
        return;
      }

      // Queued; show a printer problem (out of paper, jam, ...) if there is one.
      setError(printData.warning ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test print");
    } finally {
      setTestPrinting(false);
    }
  }

  const visibleDrawings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...drawings].sort(
      (a, b) => a.partNumber.localeCompare(b.partNumber) || a.revision.localeCompare(b.revision),
    );
    if (!q) return sorted;
    return sorted.filter(
      (d) => d.filename.toLowerCase().includes(q) || d.partNumber.toLowerCase().includes(q),
    );
  }, [drawings, search]);

  if (loading) return <PageLoading />;

  const totalSize = drawings.reduce((sum, d) => sum + (d.fileSize || 0), 0);

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-full mx-auto px-6 py-8 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-4xl text-ink">Files</h1>
          {user?.isAdmin && (
            <button
              type="button"
              onClick={handleTestPrint}
              disabled={testPrinting}
              className="px-4 py-2 text-sm font-medium border border-steel/40 text-steel-dark bg-steel-tint hover:bg-steel/20 hover:border-steel/50 active:bg-steel/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {testPrinting ? "Testing…" : "Test Print"}
            </button>
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        <PartFilesSection data={data} inProduction={inProduction} />

        <section className="space-y-3 pt-4">
          <div>
            <h2 className="font-display text-2xl text-ink">Drawings</h2>
            <p className="text-xs text-steel">
              {drawings.length} drawing{drawings.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
            </p>
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename or part number…"
            className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
          />

          {visibleDrawings.length === 0 ? (
            <div className="bg-paper border border-steel/30 rounded-lg p-6 text-center">
              <p className="text-steel text-sm">
                {drawings.length === 0
                  ? "No drawings stored yet."
                  : "No drawings match your search."}
              </p>
            </div>
          ) : (
            <ul className="bg-paper border border-steel/30 rounded-lg divide-y divide-steel/20">
              {visibleDrawings.map((drawing) => (
                <li key={drawing.r2Key} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate" title={drawing.filename}>
                      {drawing.filename}
                    </p>
                    <p className="text-xs text-steel">
                      <span className="font-mono text-steel-dark">
                        {drawing.partNumber} · Rev {drawing.revision}
                      </span>{" "}
                      · {formatBytes(drawing.fileSize || 0)} ·{" "}
                      {new Date(drawing.createdAt * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  <InProductionBadge rows={usageOfDrawing(drawing)} />
                  <button
                    type="button"
                    onClick={() => handlePrint(drawing)}
                    disabled={printingId === drawing.id}
                    className="px-2.5 py-1 text-xs font-medium bg-crimson text-paper hover:bg-crimson-dark disabled:bg-steel/30 disabled:cursor-not-allowed rounded transition-colors shrink-0"
                  >
                    {printingId === drawing.id ? "Printing…" : "Print"}
                  </button>
                  <a
                    href={`${import.meta.env.VITE_API_BASE_URL ?? ""}/parts/${drawing.partNumber}/${drawing.revision}/drawing`}
                    download={drawing.filename}
                    className="px-2.5 py-1 text-xs font-medium border border-steel/40 text-steel hover:text-ink rounded transition-colors shrink-0"
                  >
                    Download
                  </a>
                  {!kiosk.active && (
                    <button
                      type="button"
                      onClick={() => handleDeleteDrawing(drawing)}
                      disabled={deletingKey === drawing.r2Key}
                      className="px-2.5 py-1 text-xs font-medium border border-crimson/40 text-crimson hover:bg-crimson-tint rounded transition-colors disabled:opacity-50 shrink-0"
                    >
                      {deletingKey === drawing.r2Key ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
