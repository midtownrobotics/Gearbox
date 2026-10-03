import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { PrintDrawingButton } from "../../shared/print-drawing-button";
import { ErrorBanner, PageLoading } from "../../shared/ui";

interface PartDefinition {
  id: number;
  onshapePartNumber: string;
  revision: string | null;
  subsystemId: number;
  name: string | null;
  notes: string | null;
  partDrawingUrl: string | null;
  isObsolete: number;
  createdAt: number;
}

interface PartInstance {
  id: number;
  partDefinitionId: number;
  instanceNumber: number;
  isPriority: number;
  isStale: number;
  createdAt: number;
}

interface Subsystem {
  id: number;
  name: string;
  createdAt: number;
}

interface Process {
  id: number;
  name: string;
  createdAt: number;
}

interface InstanceProcess {
  id: number;
  partInstanceId: number;
  processId: number;
  index: number;
  status: "waiting" | "todo" | "doing" | "done";
  completedAt: number | null;
  createdAt: number;
}

export function PartDetailPage() {
  const [searchParams] = useSearchParams();
  const partNumber = searchParams.get("p");

  const [definitions, setDefinitions] = useState<PartDefinition[]>([]);
  const [instances, setInstances] = useState<PartInstance[]>([]);
  const [subsystems, setSubsystems] = useState<Subsystem[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [instanceProcesses, setInstanceProcesses] = useState<InstanceProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: partNumber is used via closure
  useEffect(() => {
    loadPartData();
  }, [partNumber]);

  async function loadPartData() {
    if (!partNumber) {
      setError("Part number is required");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch part definitions
      const defRes = await api["part-definitions"].$get({
        query: { onshapePartNumber: partNumber },
      });

      if (!defRes.ok) {
        setError(await getErrorMessage(defRes as unknown as Response));
        setLoading(false);
        return;
      }

      const defs = (await defRes.json()) as PartDefinition[];
      console.log("Part definitions:", defs);
      setDefinitions(defs);

      // Fetch instances for each definition
      const allInstances: PartInstance[] = [];
      if (defs.length > 0) {
        for (const def of defs) {
          try {
            // biome-ignore lint/suspicious/noExplicitAny: workaround for Hono client type generation
            const instRes = await (api as any)["part-instances"].$get({
              query: { partDefinitionId: String(def.id) },
            });

            if (!instRes.ok) {
              console.error(
                `Failed to fetch instances for definition ${def.id}: ${instRes.status}`,
                await instRes.text(),
              );
              continue;
            }

            const defInstances = (await instRes.json()) as PartInstance[];
            console.log(`Fetched ${defInstances.length} instances for definition ${def.id}`);
            allInstances.push(...defInstances);
          } catch (err) {
            console.error(`Failed to fetch instances for definition ${def.id}:`, err);
          }
        }
        console.log(`Total instances loaded: ${allInstances.length}`);
        setInstances(allInstances);
      }

      // Fetch subsystems, processes, and instance processes
      const [subsysRes, procRes] = await Promise.all([api.subsystems.$get(), api.processes.$get()]);

      if (subsysRes.ok) {
        const subsys = (await subsysRes.json()) as Subsystem[];
        console.log("Subsystems:", subsys);
        setSubsystems(subsys);
      } else {
        console.error("Failed to fetch subsystems:", subsysRes.status);
      }

      if (procRes.ok) {
        const procs = (await procRes.json()) as Process[];
        setProcesses(procs);
      }

      // Fetch instance processes for all instances
      if (allInstances.length > 0) {
        const allInstanceProcs: InstanceProcess[] = [];
        for (const inst of allInstances) {
          try {
            // biome-ignore lint/suspicious/noExplicitAny: workaround for Hono client type generation
            const instProcRes = await (api as any)["part-instance-processes"].$get({
              query: { partInstanceId: String(inst.id) },
            });

            if (instProcRes.ok) {
              const instProcs = (await instProcRes.json()) as InstanceProcess[];
              allInstanceProcs.push(...instProcs);
            }
          } catch (err) {
            console.error(`Failed to fetch processes for instance ${inst.id}:`, err);
          }
        }
        setInstanceProcesses(allInstanceProcs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load part data");
    } finally {
      setLoading(false);
    }
  }

  if (!partNumber) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <ErrorBanner message="Part number is required. Use ?p=PART_NUMBER in the URL." />
        </div>
      </main>
    );
  }

  if (loading) return <PageLoading />;

  if (error) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <ErrorBanner message={error} />
        </div>
      </main>
    );
  }

  if (definitions.length === 0) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
          <h1 className="font-display text-4xl text-ink">Part: {partNumber}</h1>
          <div className="bg-paper border border-steel/30 rounded-xl p-6">
            <p className="text-sm text-steel">
              No definitions found for this part number. Make sure this part has been{" "}
              <a href="/ingest" className="text-crimson hover:text-crimson-dark underline">
                ingested
              </a>{" "}
              and check back.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const getSubsystemName = (id: number) =>
    subsystems.find((s) => s.id === id)?.name || `Subsystem ${id}`;

  const getProcessName = (id: number) =>
    processes.find((p) => p.id === id)?.name || `Process ${id}`;

  const getCurrentProcess = (instanceId: number) => {
    const instProcs = instanceProcesses
      .filter((ip) => ip.partInstanceId === instanceId)
      .sort((a, b) => a.index - b.index);

    if (instProcs.length === 0) return null;

    const current = instProcs.find((ip) => ip.status !== "done");
    return current || instProcs[instProcs.length - 1];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "doing":
        return "text-blue-700 bg-blue-50";
      case "todo":
        return "text-yellow-700 bg-yellow-50";
      case "done":
        return "text-emerald-700 bg-emerald-50";
      default:
        return "text-steel bg-mist";
    }
  };

  const activeDef = definitions.find((d) => !d.isObsolete);

  if (!activeDef) {
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
          <h1 className="font-display text-4xl text-ink">Part: {partNumber}</h1>
          <div className="bg-paper border border-steel/30 rounded-xl p-6">
            <p className="text-sm text-steel">No active definition found for this part.</p>
          </div>
        </div>
      </main>
    );
  }

  const activeInstances = instances.filter((i) => i.partDefinitionId === activeDef.id);

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
        <h1 className="font-display text-4xl text-ink">Part: {partNumber}</h1>

        {/* Part Details */}
        <section className="space-y-3">
          <div className="space-y-3">
            {[activeDef].map((def) => (
              <div
                key={def.id}
                className="bg-paper border border-steel/30 rounded-xl p-5 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-ink text-lg">{def.name || "—"}</h3>
                      {def.isObsolete ? (
                        <span className="text-xs font-semibold px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded">
                          Obsolete
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-steel mb-2">Revision: {def.revision || "—"}</p>
                    {def.notes && <p className="text-sm text-steel-dark mb-2">{def.notes}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-steel/25">
                  <div>
                    <p className="text-xs text-steel font-semibold">Subsystem</p>
                    <p className="text-sm text-ink">{getSubsystemName(def.subsystemId)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel font-semibold">Instances</p>
                    <p className="text-sm text-ink">{activeInstances.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-steel font-semibold">Created</p>
                    <p className="text-sm text-ink">
                      {new Date(
                        typeof def.createdAt === "string"
                          ? Number.parseInt(def.createdAt)
                          : def.createdAt,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {(def.partDrawingUrl || def.revision) && (
                  <div className="pt-3 border-t border-steel/25 flex flex-wrap items-center gap-4">
                    {def.partDrawingUrl && (
                      <a
                        href={def.partDrawingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-crimson hover:text-crimson-dark underline"
                      >
                        View Drawing →
                      </a>
                    )}
                    {def.revision && (
                      <PrintDrawingButton
                        partNumber={def.onshapePartNumber}
                        revision={def.revision}
                      />
                    )}
                  </div>
                )}

                {/* Instances for this definition */}
                <div className="pt-3 border-t border-steel/25 space-y-2">
                  <p className="text-xs font-semibold text-steel-dark">Instances:</p>
                  {activeInstances.length === 0 ? (
                    <p className="text-xs text-steel">No instances for this part</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {activeInstances.map((inst) => {
                        const currentProcess = getCurrentProcess(inst.id);
                        return (
                          <a
                            key={inst.id}
                            href={`/board?instance=${inst.id}`}
                            className="bg-mist border border-steel/20 rounded p-2 hover:border-crimson/40 hover:bg-steel-tint transition-colors cursor-pointer"
                          >
                            <p className="text-xs font-medium text-ink">
                              Instance {inst.instanceNumber}
                            </p>
                            <div className="text-xs text-steel mt-1 space-y-0.5">
                              {currentProcess ? (
                                <p
                                  className={`font-semibold rounded px-1.5 py-0.5 ${getStatusColor(currentProcess.status)}`}
                                >
                                  {getProcessName(currentProcess.processId)}
                                </p>
                              ) : (
                                <p className="text-steel">No processes</p>
                              )}
                              {inst.isPriority ? (
                                <p className="text-emerald-700 font-semibold">Priority</p>
                              ) : null}
                              {inst.isStale ? (
                                <p className="text-red-700 font-semibold">Stale</p>
                              ) : null}
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Summary */}
        <section className="bg-paper border border-steel/30 rounded-xl p-5">
          <h2 className="font-semibold text-ink mb-3">Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-steel font-semibold">Revision</p>
              <p className="text-lg text-ink font-semibold">{activeDef.revision || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-steel font-semibold">Subsystem</p>
              <p className="text-lg text-ink font-semibold">
                {getSubsystemName(activeDef.subsystemId)}
              </p>
            </div>
            <div>
              <p className="text-xs text-steel font-semibold">Instances</p>
              <p className="text-lg text-ink font-semibold">{activeInstances.length}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
