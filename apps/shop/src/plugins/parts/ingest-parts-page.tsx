import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { partInfoRequiredBy, pipelineFileError } from "../../shared/derive";
import type { Process, Subsystem } from "../../shared/types";
import { ErrorBanner, PageLoading } from "../../shared/ui";
import { useShopData } from "../../shared/use-shop-data";
import { useTouchDevice } from "../../shared/use-touch";

type PendingPart = {
  id: number;
  partNumber: string;
  entityId: string | null;
  partDrawingEntityId: string | null;
  versionId: string | null;
  quantity: number | null;
  onshapeReleaseId: string;
  releaseId: number | null;
  createdAt: number;
  revision: string | null;
  name: string | null;
  description: string | null;
};

type PendingPartsData = {
  parts: PendingPart[];
  subsystems: Subsystem[];
};

type PartForm = {
  onshapePartNumber: string;
  revision: string;
  subsystemId: number;
  name: string;
  quantity: number;
  notes: string;
  partDrawingUrl: string;
  isPriority: boolean;
  processIds: number[];
  material: string;
  thickness: string;
};

type LocalPartData = {
  subsystemId: number;
  processIds: number[];
  revision?: string;
  name?: string;
  /** Undefined = untouched (use the Onshape quantity); null = cleared while typing. */
  quantity?: number | null;
  material?: string;
  thickness?: string;
};

function DrawingStatusCell({
  part,
  localPartData,
}: {
  part: PendingPart;
  localPartData: Record<string, LocalPartData>;
}) {
  const [drawingExists, setDrawingExists] = useState(false);
  const [checking, setChecking] = useState(true);
  const revision = localPartData[part.partNumber]?.revision ?? part.revision;

  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies captured via closure
  useEffect(() => {
    checkDrawing();
  }, [part.partNumber, revision]);

  async function checkDrawing() {
    try {
      setChecking(true);
      if (!revision) {
        setDrawingExists(false);
        return;
      }

      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174/api";
      const res = await fetch(`${apiBase}/parts/${part.partNumber}/${revision}/drawing`);

      // Check if we got an error response or can't parse as JSON
      if (!res.ok) {
        setDrawingExists(false);
        return;
      }

      try {
        // biome-ignore lint/suspicious/noExplicitAny: response type varies by content
        const data = (await res.json()) as any;
        if (data.error) {
          setDrawingExists(false);
          return;
        }
      } catch {
        // If we can't parse as JSON, it's likely the PDF (binary)
      }

      setDrawingExists(true);
    } catch {
      setDrawingExists(false);
    } finally {
      setChecking(false);
    }
  }

  if (checking) {
    return <span className="text-xs text-steel">…</span>;
  }

  if (drawingExists) {
    return (
      <button
        type="button"
        onClick={() => {
          const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174/api";
          window.open(`${apiBase}/parts/${part.partNumber}/${revision}/drawing`, "_blank");
        }}
        className="text-emerald-600 hover:text-emerald-700 font-semibold cursor-pointer"
        title="Click to open cached drawing"
      >
        →
      </button>
    );
  }

  if (part.partDrawingEntityId) {
    return (
      <span className="text-blue-600 font-semibold" title="Drawing entity ID available">
        ✓
      </span>
    );
  }

  return <span className="text-red-600 font-semibold">✕</span>;
}

function ProcessSelector({
  processes,
  selectedProcessIds,
  onAddProcess,
  onRemoveProcess,
  onReplaceProcess,
  onOpenFull,
}: {
  processes: Process[];
  selectedProcessIds: number[];
  onAddProcess: (procId: number) => void;
  onRemoveProcess: (idx: number) => void;
  onReplaceProcess: (idx: number, procId: number) => void;
  onOpenFull: () => void;
}) {
  const maxInline = 3;
  const availableProcesses = processes.filter((p) => !selectedProcessIds.includes(p.id));

  return (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map((slot) => {
        const procId = selectedProcessIds[slot];
        const proc = procId ? processes.find((p) => p.id === procId) : null;

        return (
          <div key={slot} className="flex items-center gap-1">
            <select
              value={procId || ""}
              onChange={(e) => {
                const newId = Number(e.target.value);
                if (!newId && procId) {
                  onRemoveProcess(slot);
                } else if (newId && newId !== procId) {
                  if (procId) {
                    onReplaceProcess(slot, newId);
                  } else {
                    onAddProcess(newId);
                  }
                }
              }}
              className="bg-paper border border-steel/40 rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-crimson"
            >
              <option value="">—</option>
              {proc && (
                <option value={procId} key={procId}>
                  {proc.name}
                </option>
              )}
              {availableProcesses.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {selectedProcessIds.length > maxInline && (
        <button
          type="button"
          onClick={onOpenFull}
          className="text-xs font-medium text-crimson hover:text-crimson-dark underline ml-2"
        >
          +{selectedProcessIds.length - maxInline}
        </button>
      )}
      {selectedProcessIds.length <= maxInline && selectedProcessIds.length < processes.length && (
        <button
          type="button"
          onClick={onOpenFull}
          className="text-xs font-medium text-steel hover:text-ink underline ml-2"
        >
          More
        </button>
      )}
    </div>
  );
}

function ProcessPanel({
  partNumber,
  processes,
  selectedProcessIds,
  onAddProcess,
  onRemoveProcess,
  onClose,
}: {
  partNumber: string;
  processes: Process[];
  selectedProcessIds: number[];
  onAddProcess: (procId: number) => void;
  onRemoveProcess: (idx: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="bg-paper w-full max-w-sm h-full shadow-lg flex flex-col">
      <div className="border-b border-steel/25 px-6 py-4 flex items-center justify-between">
        <h2 className="font-semibold text-ink">Processes: {partNumber}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-steel hover:text-ink text-xl leading-none"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-steel-dark mb-3">Available Processes</h3>
          <div className="space-y-2">
            {processes
              .filter((p) => !selectedProcessIds.includes(p.id))
              .map((proc) => (
                <button
                  key={proc.id}
                  type="button"
                  onClick={() => onAddProcess(proc.id)}
                  className="w-full text-left px-3 py-2 text-sm text-steel hover:bg-mist rounded border border-steel/20 hover:border-crimson/40 transition-colors"
                >
                  + {proc.name}
                </button>
              ))}
          </div>
        </div>

        {selectedProcessIds.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-steel-dark mb-3">Selected (in order)</h3>
            <div className="space-y-2">
              {selectedProcessIds.map((procId, idx) => {
                const proc = processes.find((p) => p.id === procId);
                return (
                  <div
                    key={procId}
                    className="flex items-center gap-2 px-3 py-2 bg-mist rounded border border-steel/20"
                  >
                    <span className="text-xs font-semibold text-steel-dark w-6">{idx + 1}.</span>
                    <span className="text-sm text-ink flex-1">{proc?.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveProcess(idx)}
                      className="text-steel hover:text-crimson text-xs font-semibold"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-steel/25 px-6 py-4 flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-steel hover:text-ink border border-steel/40 rounded-lg transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function IngestPartsPage() {
  const { data, loading } = useShopData();
  const touch = useTouchDevice();
  const [pendingData, setPendingData] = useState<PendingPartsData | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [deletingPartNumber, setDeletingPartNumber] = useState<string | null>(null);
  const [localPartData, setLocalPartData] = useState<Record<string, LocalPartData>>({});

  /** Merges edits into one part's local ingest data. */
  function updateLocal(partNumber: string, patch: Partial<LocalPartData>) {
    setLocalPartData((prev) => ({
      ...prev,
      [partNumber]: {
        ...prev[partNumber],
        subsystemId: prev[partNumber]?.subsystemId ?? 0,
        processIds: prev[partNumber]?.processIds ?? [],
        ...patch,
      },
    }));
  }
  const [editingProcessPartIdx, setEditingProcessPartIdx] = useState<number | null>(null);
  const [ingestingAll, setIngestingAll] = useState(false);

  useEffect(() => {
    loadPendingParts();
  }, []);

  useEffect(() => {
    const hasUnsavedChanges = Object.keys(localPartData).length > 0;

    if (hasUnsavedChanges) {
      window.sessionStorage.setItem("shop-unsaved-changes", "true");
    } else {
      window.sessionStorage.removeItem("shop-unsaved-changes");
    }
  }, [localPartData]);

  useEffect(() => {
    const hasUnsavedChanges = Object.keys(localPartData).length > 0;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };

    const handlePopstate = (e: PopStateEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        if (!window.confirm("You have unsaved changes. Are you sure you want to leave?")) {
          window.history.pushState(null, "", window.location.pathname);
        }
      }
    };

    const handleLinkClick = (e: MouseEvent) => {
      if (!hasUnsavedChanges) return;

      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("?")) return;

      e.preventDefault();
      e.stopPropagation();

      if (window.confirm("You have unsaved changes. Are you sure you want to leave?")) {
        window.sessionStorage.removeItem("shop-unsaved-changes");
        window.location.href = href;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopstate);
    document.addEventListener("click", handleLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopstate);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [localPartData]);

  async function loadPendingParts() {
    try {
      setPendingLoading(true);
      setError(null);
      const res = await api.admin.parts.pending.$get();
      if (!res.ok) {
        setError(await getErrorMessage(res as unknown as Response));
        return;
      }
      const result = (await res.json()) as PendingPartsData;
      setPendingData(result);
      setCurrentIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending parts");
    } finally {
      setPendingLoading(false);
    }
  }

  async function handleDeletePart(partNumber: string) {
    setDeletingPartNumber(partNumber);
    try {
      const res = await api.admin.parts[":partNumber"].$delete({ param: { partNumber } });

      if (!res.ok) {
        setError(await getErrorMessage(res as unknown as Response));
        return;
      }

      // Reload the pending parts list
      await loadPendingParts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete part");
    } finally {
      setDeletingPartNumber(null);
    }
  }

  if (loading || pendingLoading) return <PageLoading />;

  if (error) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-full mx-auto px-6 py-8 space-y-5">
          <h1 className="font-display text-4xl text-ink">Ingest Parts</h1>
          <ErrorBanner message={error} />
        </div>
      </main>
    );
  }

  if (!pendingData || pendingData.parts.length === 0) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-full mx-auto px-6 py-8 space-y-5">
          <h1 className="font-display text-4xl text-ink">Ingest Parts</h1>
          <div className="bg-paper border border-steel/30 rounded-xl p-6">
            <p className="text-sm text-steel">No pending parts to ingest.</p>
          </div>
        </div>
      </main>
    );
  }

  // If currentIndex is null, show list view; otherwise show detail view
  if (currentIndex === null) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-full mx-auto px-6 py-8 space-y-5">
          <h1 className="font-display text-4xl text-ink">Ingest Parts</h1>

          <div className="bg-paper border border-steel/30 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-mist border-b border-steel/25">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">
                      Part Number
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">Rev</th>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">Qty</th>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">Subsystem</th>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">Processes</th>
                    <th className="px-4 py-3 text-left font-semibold text-steel-dark">
                      Material / Thickness
                    </th>
                    <th className="px-4 py-3 text-center font-semibold text-steel-dark">Drawing</th>
                    <th className="px-4 py-3 text-right font-semibold text-steel-dark">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-steel/25">
                  {pendingData.parts.map((part, idx) => (
                    <tr
                      key={`${part.onshapeReleaseId}-${part.partNumber}`}
                      className="hover:bg-mist transition-colors"
                    >
                      <td className="px-4 py-3 text-ink font-medium font-mono text-xs">
                        {part.partNumber}
                      </td>
                      <td className="px-4 py-3 text-steel text-xs">
                        {(localPartData[part.partNumber]?.revision ?? part.revision) || "—"}
                      </td>
                      <td className="px-4 py-3 text-ink text-xs truncate max-w-xs">
                        {(localPartData[part.partNumber]?.name ?? part.name) || "—"}
                      </td>
                      <td className="px-4 py-3 text-steel text-xs">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={
                            localPartData[part.partNumber]?.quantity === null
                              ? ""
                              : (localPartData[part.partNumber]?.quantity ?? part.quantity ?? "")
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "" || /^\d+$/.test(val)) {
                              setLocalPartData({
                                ...localPartData,
                                [part.partNumber]: {
                                  ...localPartData[part.partNumber],
                                  subsystemId: localPartData[part.partNumber]?.subsystemId || 0,
                                  processIds: localPartData[part.partNumber]?.processIds || [],
                                  revision: localPartData[part.partNumber]?.revision,
                                  name: localPartData[part.partNumber]?.name,
                                  quantity: val === "" ? null : Number(val),
                                },
                              });
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value === "") {
                              setLocalPartData({
                                ...localPartData,
                                [part.partNumber]: {
                                  ...localPartData[part.partNumber],
                                  subsystemId: localPartData[part.partNumber]?.subsystemId || 0,
                                  processIds: localPartData[part.partNumber]?.processIds || [],
                                  revision: localPartData[part.partNumber]?.revision,
                                  name: localPartData[part.partNumber]?.name,
                                  quantity: 1,
                                },
                              });
                            }
                          }}
                          className="w-16 bg-paper border border-steel/40 rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-crimson"
                        />
                      </td>
                      <td className="px-4 py-3 text-steel text-xs">
                        <select
                          value={localPartData[part.partNumber]?.subsystemId || 0}
                          onChange={(e) =>
                            setLocalPartData({
                              ...localPartData,
                              [part.partNumber]: {
                                ...localPartData[part.partNumber],
                                subsystemId: Number(e.target.value),
                                processIds: localPartData[part.partNumber]?.processIds || [],
                                revision: localPartData[part.partNumber]?.revision,
                                name: localPartData[part.partNumber]?.name,
                                quantity: localPartData[part.partNumber]?.quantity,
                              },
                            })
                          }
                          className="bg-paper border border-steel/40 rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-crimson"
                        >
                          <option value={0}>— Select —</option>
                          {pendingData.subsystems.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-steel text-xs">
                        {data && (
                          <ProcessSelector
                            processes={data.processes}
                            selectedProcessIds={localPartData[part.partNumber]?.processIds || []}
                            onAddProcess={(procId) => {
                              setLocalPartData({
                                ...localPartData,
                                [part.partNumber]: {
                                  ...localPartData[part.partNumber],
                                  subsystemId: localPartData[part.partNumber]?.subsystemId || 0,
                                  processIds: [
                                    ...(localPartData[part.partNumber]?.processIds || []),
                                    procId,
                                  ],
                                  revision: localPartData[part.partNumber]?.revision,
                                  name: localPartData[part.partNumber]?.name,
                                  quantity: localPartData[part.partNumber]?.quantity,
                                },
                              });
                            }}
                            onReplaceProcess={(slotIdx, procId) => {
                              const newProcessIds = [
                                ...(localPartData[part.partNumber]?.processIds || []),
                              ];
                              newProcessIds[slotIdx] = procId;
                              setLocalPartData({
                                ...localPartData,
                                [part.partNumber]: {
                                  ...localPartData[part.partNumber],
                                  subsystemId: localPartData[part.partNumber]?.subsystemId || 0,
                                  processIds: newProcessIds,
                                  revision: localPartData[part.partNumber]?.revision,
                                  name: localPartData[part.partNumber]?.name,
                                  quantity: localPartData[part.partNumber]?.quantity,
                                },
                              });
                            }}
                            onRemoveProcess={(idx) => {
                              setLocalPartData({
                                ...localPartData,
                                [part.partNumber]: {
                                  ...localPartData[part.partNumber],
                                  subsystemId: localPartData[part.partNumber]?.subsystemId || 0,
                                  processIds: localPartData[part.partNumber].processIds.filter(
                                    (_, i) => i !== idx,
                                  ),
                                  revision: localPartData[part.partNumber]?.revision,
                                  name: localPartData[part.partNumber]?.name,
                                  quantity: localPartData[part.partNumber]?.quantity,
                                },
                              });
                            }}
                            onOpenFull={() => setEditingProcessPartIdx(idx)}
                          />
                        )}
                        {data &&
                          (() => {
                            const fileError = pipelineFileError(
                              localPartData[part.partNumber]?.processIds ?? [],
                              data.processes,
                            );
                            return fileError ? (
                              <p className="mt-1 text-crimson-dark">{fileError}</p>
                            ) : null;
                          })()}
                      </td>
                      <td className="px-4 py-3 text-steel text-xs">
                        {data &&
                        partInfoRequiredBy(
                          localPartData[part.partNumber]?.processIds ?? [],
                          data.processes,
                        ).length > 0 ? (
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={localPartData[part.partNumber]?.material ?? ""}
                              onChange={(e) =>
                                updateLocal(part.partNumber, { material: e.target.value })
                              }
                              placeholder="Material"
                              aria-label={`Material for ${part.partNumber}`}
                              className="w-24 bg-paper border border-steel/40 rounded px-2 py-1 text-xs text-ink placeholder-steel focus:outline-none focus:border-crimson"
                            />
                            <input
                              type="text"
                              value={localPartData[part.partNumber]?.thickness ?? ""}
                              onChange={(e) =>
                                updateLocal(part.partNumber, { thickness: e.target.value })
                              }
                              placeholder='0.25"'
                              aria-label={`Thickness for ${part.partNumber}`}
                              className="w-16 bg-paper border border-steel/40 rounded px-2 py-1 text-xs text-ink placeholder-steel focus:outline-none focus:border-crimson"
                            />
                          </div>
                        ) : (
                          <span className="text-steel/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-steel text-center">
                        <DrawingStatusCell part={part} localPartData={localPartData} />
                      </td>
                      <td className="px-4 py-3 text-right flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setCurrentIndex(idx)}
                          className="text-xs font-medium text-crimson hover:text-crimson-dark underline"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePart(part.partNumber)}
                          disabled={deletingPartNumber === part.partNumber}
                          className="text-xs font-medium text-steel hover:text-steel-dark disabled:opacity-50"
                        >
                          {deletingPartNumber === part.partNumber ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pendingData && (
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                disabled={
                  ingestingAll ||
                  !pendingData.parts.every((p) => {
                    const partData = localPartData[p.partNumber];
                    const revision = partData?.revision ?? p.revision;
                    const name = partData?.name ?? p.name;
                    const infoOk =
                      !data ||
                      partInfoRequiredBy(partData?.processIds ?? [], data.processes).length === 0 ||
                      (!!partData?.material?.trim() && !!partData?.thickness?.trim());
                    const filesOk =
                      !data || !pipelineFileError(partData?.processIds ?? [], data.processes);
                    return partData?.subsystemId && revision && name && infoOk && filesOk;
                  })
                }
                onClick={async () => {
                  setIngestingAll(true);
                  try {
                    for (const part of pendingData.parts) {
                      const partData = localPartData[part.partNumber];
                      if (!partData?.subsystemId) continue;

                      const quantity = partData.quantity ?? part.quantity ?? 1;

                      // Create part definition
                      const defRes = await api["part-definitions"].$post({
                        json: {
                          onshapePartNumber: part.partNumber,
                          revision: partData.revision ?? part.revision ?? undefined,
                          subsystemId: partData.subsystemId,
                          name: partData.name ?? part.name ?? undefined,
                          notes: part.description || undefined,
                          partDrawingUrl: "",
                          processIds: partData.processIds || [],
                          material: partData.material?.trim() || undefined,
                          thickness: partData.thickness?.trim() || undefined,
                        },
                      });

                      if (!defRes.ok) {
                        const errData = (await defRes.json()) as { error?: string };
                        throw new Error(
                          `Failed to create part ${part.partNumber}: ${errData.error || defRes.statusText}`,
                        );
                      }

                      const definition = (await defRes.json()) as { id: number };

                      // Create part instances
                      const instRes = await api["part-instances"].$post({
                        json: {
                          partDefinitionId: definition.id,
                          quantity,
                        },
                      });

                      if (!instRes.ok) {
                        const errData = (await instRes.json()) as { error?: string };
                        throw new Error(
                          `Failed to create instances for ${part.partNumber}: ${errData.error || instRes.statusText}`,
                        );
                      }
                    }
                    await loadPendingParts();
                    setLocalPartData({});
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to ingest parts");
                  } finally {
                    setIngestingAll(false);
                  }
                }}
                className="px-6 py-2 text-sm font-semibold text-paper bg-crimson hover:bg-crimson-dark disabled:bg-steel/30 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {ingestingAll ? "Ingesting…" : "Ingest All"}
              </button>
            </div>
          )}

          {editingProcessPartIdx !== null && data && (
            <div className="fixed inset-0 bg-black/30 z-40 flex justify-end">
              <ProcessPanel
                partNumber={pendingData.parts[editingProcessPartIdx]?.partNumber}
                processes={data.processes}
                selectedProcessIds={
                  localPartData[pendingData.parts[editingProcessPartIdx].partNumber]?.processIds ||
                  []
                }
                onAddProcess={(procId) => {
                  const partNum = pendingData.parts[editingProcessPartIdx].partNumber;
                  setLocalPartData({
                    ...localPartData,
                    [partNum]: {
                      ...localPartData[partNum],
                      subsystemId: localPartData[partNum]?.subsystemId || 0,
                      processIds: [...(localPartData[partNum]?.processIds || []), procId],
                      revision: localPartData[partNum]?.revision,
                      name: localPartData[partNum]?.name,
                      quantity: localPartData[partNum]?.quantity,
                    },
                  });
                }}
                onRemoveProcess={(idx) => {
                  const partNum = pendingData.parts[editingProcessPartIdx].partNumber;
                  setLocalPartData({
                    ...localPartData,
                    [partNum]: {
                      ...localPartData[partNum],
                      subsystemId: localPartData[partNum]?.subsystemId || 0,
                      processIds: localPartData[partNum].processIds.filter((_, i) => i !== idx),
                      revision: localPartData[partNum]?.revision,
                      name: localPartData[partNum]?.name,
                      quantity: localPartData[partNum]?.quantity,
                    },
                  });
                }}
                onClose={() => setEditingProcessPartIdx(null)}
              />
            </div>
          )}
        </div>
      </main>
    );
  }

  const currentPart = pendingData.parts[currentIndex];
  if (!currentPart) return null;

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
        <button
          type="button"
          onClick={() => {
            setCurrentIndex(null);
            window.scrollTo(0, 0);
          }}
          className="text-sm text-steel hover:text-ink transition-colors"
        >
          ← Back to List
        </button>
        <h1 className="font-display text-4xl text-ink">Ingest Parts</h1>

        <div className="text-sm text-steel">
          Part {currentIndex + 1} of {pendingData.parts.length}
        </div>

        {data && (
          <PartIngestCard
            part={currentPart}
            subsystems={pendingData.subsystems}
            processes={data.processes}
            localPartData={localPartData[currentPart.partNumber]}
            onUpdateLocalPartData={(partData) => updateLocal(currentPart.partNumber, partData)}
            onRemoveFromLocal={() => {
              const newLocalData = { ...localPartData };
              delete newLocalData[currentPart.partNumber];
              setLocalPartData(newLocalData);
            }}
            onNext={() => {
              if (currentIndex + 1 < pendingData.parts.length) {
                setCurrentIndex(currentIndex + 1);
              } else {
                setCurrentIndex(null);
              }
            }}
            onBack={() => setCurrentIndex(null)}
            onRefresh={loadPendingParts}
            touch={touch}
          />
        )}
      </div>
    </main>
  );
}

function PartIngestCard({
  part,
  subsystems,
  processes,
  localPartData,
  onUpdateLocalPartData,
  onRemoveFromLocal,
  onNext,
  onRefresh,
  touch,
  onBack,
}: {
  part: PendingPart;
  subsystems: Subsystem[];
  processes: Process[];
  localPartData?: LocalPartData;
  onUpdateLocalPartData: (partData: Partial<LocalPartData>) => void;
  onRemoveFromLocal: () => void;
  onNext: () => void;
  onRefresh: () => void;
  touch: boolean;
  onBack: () => void;
}) {
  const [form, setForm] = useState<PartForm>({
    onshapePartNumber: part.partNumber,
    revision: localPartData?.revision ?? part.revision ?? "",
    subsystemId: localPartData?.subsystemId ?? 0,
    name: localPartData?.name ?? part.name ?? "",
    quantity: localPartData?.quantity ?? part.quantity ?? 1,
    notes: part.description ?? "",
    partDrawingUrl: "",
    isPriority: false,
    processIds: localPartData?.processIds ?? [],
    material: localPartData?.material ?? "",
    thickness: localPartData?.thickness ?? "",
  });
  const infoRequiredBy = partInfoRequiredBy(form.processIds, processes);
  const [quantityInput, setQuantityInput] = useState<string>(
    String(localPartData?.quantity ?? part.quantity ?? 1),
  );

  const [drawingFetching, setDrawingFetching] = useState(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [drawingSuccess, setDrawingSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [existingRevisions, setExistingRevisions] = useState<string[]>([]);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [checkingDrawing, setCheckingDrawing] = useState(true);

  // Load document ID and check if drawing exists
  useEffect(() => {
    loadDocumentId();
    checkIfDrawingExists();
  }, []);

  async function loadDocumentId() {
    try {
      const res = await api.admin.onshape.config.$get();
      if (res.ok) {
        const config = (await res.json()) as { documentId: string };
        setDocumentId(config.documentId);
      }
    } catch (err) {
      console.error("Failed to load document ID");
    }
  }

  async function checkIfDrawingExists() {
    try {
      setCheckingDrawing(true);
      const revision = part.revision || form.revision;
      if (!revision) {
        return;
      }
      const exists = await checkDrawingExists();
      if (exists) {
        const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174/api";
        const drawingUrl = `${apiBase}/parts/${part.partNumber}/${revision}/drawing`;
        setForm((prev) => ({ ...prev, partDrawingUrl: drawingUrl }));
        setDrawingSuccess(true);
      }
    } finally {
      setCheckingDrawing(false);
    }
  }

  async function checkDrawingExists() {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174/api";
      const revision = part.revision || form.revision;
      const res = await fetch(`${apiBase}/parts/${part.partNumber}/${revision}/drawing`);

      // Check if we got an error response (either status or body)
      if (!res.ok) {
        return false;
      }

      // Also check if the response contains an error message
      try {
        // biome-ignore lint/suspicious/noExplicitAny: response type varies by content
        const data = (await res.json()) as any;
        if (data.error) {
          return false;
        }
      } catch {
        // If we can't parse as JSON, assume it's the PDF (binary)
      }

      return true;
    } catch {
      return false;
    }
  }

  async function handleFetchDrawing() {
    await performDrawingFetch();
  }

  async function performDrawingFetch() {
    setDrawingFetching(true);
    setDrawingError(null);
    setDrawingSuccess(false);

    try {
      const revision = part.revision || form.revision;

      if (!revision || !part.partNumber) {
        setDrawingError("Revision and part number are required for auto-fetch.");
        return;
      }

      const res = await api.admin.parts[":partNumber"][":revision"]["fetch-drawing"].$post({
        param: { partNumber: part.partNumber, revision },
      });

      if (!res.ok) {
        setDrawingError(await getErrorMessage(res as unknown as Response));
        return;
      }

      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5174/api";
      const drawingUrl = `${apiBase}/parts/${part.partNumber}/${revision}/drawing`;
      setForm((prev) => ({ ...prev, partDrawingUrl: drawingUrl }));
      setDrawingSuccess(true);
    } catch (err) {
      setDrawingError(err instanceof Error ? err.message : "Failed to fetch drawing");
    } finally {
      setDrawingFetching(false);
    }
  }

  function setProcessAt(index: number, processId: number) {
    setForm((prev) => {
      const next = { ...prev };
      if (processId === 0) {
        next.processIds.splice(index, 1);
      } else {
        next.processIds[index] = processId;
      }
      onUpdateLocalPartData({
        subsystemId: next.subsystemId,
        processIds: next.processIds,
        revision: next.revision,
        name: next.name,
        quantity: next.quantity,
      });
      return next;
    });
  }

  async function checkForDuplicates(): Promise<string[]> {
    try {
      const res = await api["part-definitions"].$get({
        query: { onshapePartNumber: form.onshapePartNumber.trim() },
      });
      if (res.ok) {
        const parts = (await res.json()) as { revision: string }[];
        return parts.map((p) => p.revision);
      }
      return [];
    } catch {
      return [];
    }
  }

  async function handleSubmit() {
    if (
      !form.onshapePartNumber.trim() ||
      !form.revision.trim() ||
      !form.name.trim() ||
      !form.subsystemId
    ) {
      setFormError("Onshape part number, revision, subsystem, and name are required.");
      return;
    }
    if (!Number.isInteger(form.quantity) || form.quantity < 1) {
      setFormError("Quantity must be a whole number of at least 1.");
      return;
    }
    if (infoRequiredBy.length > 0 && (!form.material.trim() || !form.thickness.trim())) {
      setFormError(`Material and thickness are required for ${infoRequiredBy.join(", ")}.`);
      return;
    }
    const fileError = pipelineFileError(form.processIds, processes);
    if (fileError) {
      setFormError(fileError);
      return;
    }

    // Check for existing parts with same number
    const revisions = await checkForDuplicates();
    if (revisions.length > 0) {
      setExistingRevisions(revisions);
      setShowDuplicateConfirm(true);
      return;
    }

    await performCreate(false);
  }

  async function performCreate(obsolete = false) {
    setFormError("");
    setSubmitting(true);

    try {
      const createPayload = {
        onshapePartNumber: form.onshapePartNumber.trim(),
        revision: form.revision.trim() || undefined,
        subsystemId: form.subsystemId,
        name: form.name.trim() || undefined,
        notes: form.notes.trim() || undefined,
        partDrawingUrl: form.partDrawingUrl.trim() || undefined,
        processIds: form.processIds,
        obsoleteExisting: obsolete,
        material: form.material.trim() || undefined,
        thickness: form.thickness.trim() || undefined,
      };

      const defRes = await api["part-definitions"].$post({
        json: createPayload,
      });

      if (!defRes.ok) {
        setBanner(await getErrorMessage(defRes as unknown as Response));
        return;
      }

      const definition = (await defRes.json()) as { id: number };

      const instRes = await api["part-instances"].$post({
        json: {
          partDefinitionId: definition.id,
          quantity: form.quantity,
        },
      });

      if (!instRes.ok) {
        setBanner(await getErrorMessage(instRes as unknown as Response));
        return;
      }

      const instances = (await instRes.json()) as { id: number }[];

      if (form.isPriority) {
        await Promise.all(
          instances.map((inst) =>
            api["part-instances"][":id"].$patch({
              param: { id: String(inst.id) },
              json: { isPriority: true },
            }),
          ),
        );
      }

      setShowDuplicateConfirm(false);
      await onRefresh();
      // Remove from local state so warning doesn't show
      onRemoveFromLocal();
      // Reset errors and scroll to top
      setFormError("");
      setBanner(null);
      setDrawingError(null);
      setDrawingSuccess(false);
      window.scrollTo(0, 0);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-paper border border-steel/30 rounded-xl p-6 space-y-4">
      <div className="pb-2 border-b border-steel/25 space-y-2">
        <h3 className="font-semibold text-ink">{part.partNumber}</h3>
        <p className="text-xs text-steel">From OnShape Release: {part.onshapeReleaseId}</p>
        {documentId && part.entityId && part.versionId && (
          <a
            href={`https://cad.onshape.com/documents/${documentId}/v/${part.versionId}/e/${part.entityId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-crimson hover:text-crimson-dark underline"
          >
            View in OnShape →
          </a>
        )}
      </div>

      {banner && (
        <div className="text-sm text-crimson-dark bg-crimson-50 border border-crimson-200 rounded-lg px-3 py-2">
          {banner}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Onshape Part Number"
          required
          value={form.onshapePartNumber}
          onChange={(v) => setForm({ ...form, onshapePartNumber: v })}
          placeholder="P-0042"
        />
        <Field
          label="Revision"
          required
          value={form.revision}
          onChange={(v) => {
            setForm({ ...form, revision: v });
            onUpdateLocalPartData({
              subsystemId: form.subsystemId,
              processIds: form.processIds,
              revision: v,
              name: form.name,
              quantity: form.quantity,
            });
          }}
          placeholder="A"
        />
        <div className="space-y-1">
          <FieldLabel label="Subsystem" required />
          <select
            value={form.subsystemId}
            onChange={(e) => {
              const subsystemId = Number(e.target.value);
              setForm({ ...form, subsystemId });
              onUpdateLocalPartData({
                subsystemId,
                processIds: form.processIds,
                revision: form.revision,
                name: form.name,
                quantity: form.quantity,
              });
            }}
            className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
          >
            <option value={0}>Select…</option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Name"
          required
          value={form.name}
          onChange={(v) => {
            setForm({ ...form, name: v });
            onUpdateLocalPartData({
              subsystemId: form.subsystemId,
              processIds: form.processIds,
              revision: form.revision,
              name: v,
              quantity: form.quantity,
            });
          }}
          placeholder="Same as Onshape"
        />
        <div className="space-y-1">
          <FieldLabel label="Quantity" required />
          <input
            type="text"
            inputMode="numeric"
            value={quantityInput}
            onChange={(e) => {
              const val = e.target.value;
              setQuantityInput(val);
              if (val !== "" && /^\d+$/.test(val)) {
                const quantity = Number(val);
                setForm({
                  ...form,
                  quantity,
                });
                onUpdateLocalPartData({
                  subsystemId: form.subsystemId,
                  processIds: form.processIds,
                  revision: form.revision,
                  name: form.name,
                  quantity,
                });
              }
            }}
            onBlur={(e) => {
              if (e.target.value === "") {
                const quantity = 1;
                setQuantityInput(String(quantity));
                setForm({
                  ...form,
                  quantity,
                });
                onUpdateLocalPartData({
                  subsystemId: form.subsystemId,
                  processIds: form.processIds,
                  revision: form.revision,
                  name: form.name,
                  quantity,
                });
              }
            }}
            className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
          />
        </div>
        <Field
          label="Notes"
          value={form.notes}
          onChange={(v) => setForm({ ...form, notes: v })}
          placeholder="Optional"
        />
        {infoRequiredBy.length > 0 && (
          <>
            <Field
              label="Material"
              required
              value={form.material}
              onChange={(v) => {
                setForm({ ...form, material: v });
                onUpdateLocalPartData({ material: v });
              }}
              placeholder="e.g. 4140"
              hint={`Required by ${infoRequiredBy.join(", ")}`}
            />
            <Field
              label="Thickness"
              required
              value={form.thickness}
              onChange={(v) => {
                setForm({ ...form, thickness: v });
                onUpdateLocalPartData({ thickness: v });
              }}
              placeholder='e.g. 0.25"'
            />
          </>
        )}
        <div className="sm:col-span-2 space-y-1">
          <div className="flex items-center justify-between">
            <FieldLabel label="Part Drawing URL" />
            {form.partDrawingUrl && (
              <button
                type="button"
                onClick={() => window.open(form.partDrawingUrl, "_blank")}
                className="text-xs text-crimson hover:text-crimson-dark underline"
              >
                Open →
              </button>
            )}
          </div>
          <input
            type="text"
            value={form.partDrawingUrl}
            onChange={(e) => setForm({ ...form, partDrawingUrl: e.target.value })}
            placeholder="https://…"
            className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
          />
          <p className="text-xs text-steel">Can be auto-populated by fetching from OnShape</p>
        </div>
      </div>

      <div className="p-3 bg-mist rounded-lg border border-steel/25 space-y-2">
        {checkingDrawing ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-steel-dark mb-2">Checking for drawing…</p>
          </div>
        ) : drawingSuccess ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-steel-dark mb-2">Auto-fetch Drawing</p>
            <button
              type="button"
              disabled
              className="text-xs font-medium rounded-lg transition-colors px-3 py-1.5 w-full bg-emerald-50 border border-emerald-300 text-emerald-700 cursor-default"
            >
              ✓ Drawing Cached
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-steel-dark mb-2">Auto-fetch Drawing</p>
            <button
              type="button"
              onClick={handleFetchDrawing}
              disabled={drawingFetching}
              className={`text-xs font-medium rounded-lg transition-colors px-3 py-1.5 w-full ${
                drawingError
                  ? "bg-crimson-50 border border-crimson-200 text-crimson hover:bg-crimson-100"
                  : "bg-paper border border-steel/40 text-ink hover:bg-steel-tint"
              }`}
            >
              {drawingFetching ? "Fetching…" : drawingError ? "⚠ Retry" : "Try Auto Fetch"}
            </button>
          </div>
        )}
        {drawingError && <p className="text-xs text-crimson-dark">{drawingError}</p>}
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-ink">
        <input
          type="checkbox"
          checked={form.isPriority}
          onChange={(e) => setForm({ ...form, isPriority: e.target.checked })}
          className="accent-crimson w-4 h-4"
        />
        Priority part
      </label>

      <hr className="border-steel/25" />

      <div className="space-y-2">
        <FieldLabel label="Processes" />
        <p className="text-xs text-steel">
          The order here is the order the part moves through the shop.
        </p>
        {processes.length === 0 ? (
          <p className="text-sm text-steel">No processes exist yet.</p>
        ) : (
          <div className="space-y-2">
            {form.processIds.map((pid, i) => (
              <div key={`${i}-${pid}`} className="flex items-center gap-2">
                <span className="w-6 text-sm font-mono text-steel text-right shrink-0">
                  {i + 1}.
                </span>
                <select
                  value={pid}
                  onChange={(e) => setProcessAt(i, Number(e.target.value))}
                  className="flex-1 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-crimson"
                >
                  <option value={0}>Remove</option>
                  {processes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-6 text-sm font-mono text-steel text-right shrink-0">
                {form.processIds.length + 1}.
              </span>
              <select
                value={0}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  if (pid) setForm((prev) => ({ ...prev, processIds: [...prev.processIds, pid] }));
                }}
                className="flex-1 bg-mist border border-dashed border-steel/40 rounded-lg px-3 py-2 text-sm text-steel-dark focus:outline-none focus:border-crimson"
              >
                <option value={0}>Add a process…</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {formError && <p className="text-crimson-dark text-sm">{formError}</p>}

      {showDuplicateConfirm && (
        <div className="p-4 bg-crimson-50 border border-crimson-200 rounded-lg space-y-2">
          <p className="text-sm font-medium text-crimson-dark">
            A part with number <span className="font-mono">{form.onshapePartNumber}</span> already
            exists in the system
          </p>
          <p className="text-xs text-crimson">
            Existing revisions: <span className="font-mono">{existingRevisions.join(", ")}</span>
          </p>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowDuplicateConfirm(false);
              }}
              className="text-xs font-medium rounded-lg px-3 py-1.5 bg-paper border border-steel/40 text-ink hover:bg-steel-tint"
            >
              Skip This Part
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDuplicateConfirm(false);
                performCreate(true);
              }}
              className="text-xs font-medium rounded-lg px-3 py-1.5 bg-crimson hover:bg-crimson-dark text-paper"
            >
              Obsolete Old Revisions & Add
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={`bg-crimson hover:bg-crimson-dark disabled:opacity-50 text-paper text-sm font-semibold rounded-lg transition-colors ${
            touch ? "px-6 py-3" : "px-5 py-2"
          }`}
        >
          {submitting ? "Creating…" : "Create Part & Instances"}
        </button>
        <button
          type="button"
          onClick={() => {
            setFormError("");
            setBanner(null);
            setDrawingError(null);
            setDrawingSuccess(false);
            window.scrollTo(0, 0);
            onNext();
          }}
          disabled={submitting}
          className={`bg-steel-tint hover:bg-steel/30 text-steel-dark text-sm font-medium rounded-lg transition-colors ${
            touch ? "px-6 py-3" : "px-5 py-2"
          }`}
        >
          Skip to Next
        </button>
        <button
          type="button"
          onClick={() => {
            onBack();
            window.scrollTo(0, 0);
          }}
          className={`ml-auto bg-paper border border-steel/40 hover:bg-mist text-ink text-sm font-medium rounded-lg transition-colors ${
            touch ? "px-6 py-3" : "px-5 py-2"
          }`}
        >
          ← Back to List
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="text-xs font-medium text-steel-dark">
      {label}
      {required && <span className="text-crimson"> *</span>}
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel label={label} required={required} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
      />
      {hint && <p className="text-xs text-steel">{hint}</p>}
    </div>
  );
}
