import { Badge, Card, ErrorBanner, Loading, Page, Stat } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { onshapeLinkFor, useOnshapeLinks } from "../../shared/onshape-links";
import { OnshapePartLinks } from "../../shared/onshape-part-links";
import { PrintDrawingButton } from "../../shared/print-drawing-button";
import { projectName, useProjects } from "../../shared/projects";

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
  projectId: number;
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
  const onshapeLinks = useOnshapeLinks();

  const [definitions, setDefinitions] = useState<PartDefinition[]>([]);
  const [instances, setInstances] = useState<PartInstance[]>([]);
  const [subsystems, setSubsystems] = useState<Subsystem[]>([]);
  const projects = useProjects();
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

  const title = partNumber ? `Part: ${partNumber}` : "Part";

  if (!partNumber || loading || error) {
    return (
      <Page title={title}>
        {!partNumber ? (
          <ErrorBanner message="No part number. Look one up on the Parts page." />
        ) : error ? (
          <ErrorBanner message={error} />
        ) : (
          <Loading />
        )}
      </Page>
    );
  }

  if (definitions.length === 0) {
    return (
      <Page title={title}>
        <p className="text-sm text-secondary-500">
          Nothing has this part number yet.{" "}
          <Link to="/ingest" className="font-semibold text-primary-600 hover:underline">
            Check Ingest for it.
          </Link>
        </p>
      </Page>
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
        return "text-sky-800 bg-sky-50";
      case "todo":
        return "text-amber-800 bg-amber-50";
      case "done":
        return "text-emerald-800 bg-emerald-50";
      default:
        return "text-secondary-500 bg-page";
    }
  };

  const activeDef = definitions.find((d) => !d.isObsolete);

  if (!activeDef) {
    return (
      <Page title={title}>
        <p className="text-sm text-secondary-500">Every revision of this part is obsolete.</p>
      </Page>
    );
  }

  const activeInstances = instances.filter((i) => i.partDefinitionId === activeDef.id);
  const onshape = onshapeLinkFor(onshapeLinks, activeDef.onshapePartNumber, activeDef.revision);

  return (
    <Page title={title}>
      <>
        {/* Part Details */}
        <section className="space-y-3">
          <div className="space-y-3">
            {[activeDef].map((def) => (
              <div
                key={def.id}
                className="bg-surface border border-secondary-200 rounded-xl p-5 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h2 className="font-sans font-semibold text-secondary-900 text-lg">
                        {def.name || "—"}
                      </h2>
                      {def.isObsolete ? <Badge>Obsolete</Badge> : null}
                    </div>
                    <p className="text-xs text-secondary-400 mb-2">
                      Revision: {def.revision || "—"}
                    </p>
                    {def.notes && <p className="text-sm text-secondary-500 mb-2">{def.notes}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-secondary-200">
                  <div>
                    <p className="text-xs text-secondary-400 font-semibold">Subsystem</p>
                    <p className="text-sm text-secondary-900">
                      {getSubsystemName(def.subsystemId)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-secondary-400 font-semibold">Instances</p>
                    <p className="text-sm text-secondary-900">{activeInstances.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-secondary-400 font-semibold">Created</p>
                    <p className="text-sm text-secondary-900">
                      {new Date(
                        typeof def.createdAt === "string"
                          ? Number.parseInt(def.createdAt)
                          : def.createdAt,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {(def.partDrawingUrl || def.revision || onshape) && (
                  <div className="pt-3 border-t border-secondary-200 flex flex-wrap items-center gap-4">
                    {def.partDrawingUrl && (
                      <a
                        href={def.partDrawingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-primary-600 hover:text-primary-700 underline"
                      >
                        View drawing →
                      </a>
                    )}
                    <OnshapePartLinks link={onshape} className="text-xs font-medium" />
                    {def.revision && (
                      <PrintDrawingButton
                        partNumber={def.onshapePartNumber}
                        revision={def.revision}
                      />
                    )}
                  </div>
                )}

                {/* Instances for this definition */}
                <div className="pt-3 border-t border-secondary-200 space-y-2">
                  <p className="text-xs font-semibold text-secondary-500">Instances:</p>
                  {activeInstances.length === 0 ? (
                    <p className="text-xs text-secondary-400">No instances for this part</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {activeInstances.map((inst) => {
                        const currentProcess = getCurrentProcess(inst.id);
                        return (
                          <a
                            key={inst.id}
                            href={`/board?instance=${inst.id}`}
                            className="bg-page border border-secondary-200 rounded p-2 hover:border-secondary-400 hover:bg-inset transition-colors cursor-pointer"
                          >
                            <p className="text-xs font-medium text-secondary-900">
                              Instance {inst.instanceNumber}
                            </p>
                            <div className="text-xs text-secondary-400 mt-1 space-y-0.5">
                              {currentProcess ? (
                                <p
                                  className={`font-semibold rounded px-1.5 py-0.5 ${getStatusColor(currentProcess.status)}`}
                                >
                                  {getProcessName(currentProcess.processId)}
                                </p>
                              ) : (
                                <p className="text-secondary-400">No processes</p>
                              )}
                              {inst.isPriority ? (
                                <p className="text-amber-700 font-semibold">Priority</p>
                              ) : null}
                              {inst.isStale ? (
                                <p className="text-secondary-500 font-semibold">Obsolete</p>
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
        <Card title="Summary">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Stat label="Revision" value={activeDef.revision || "—"} />
            {projects.length > 1 && (
              <Stat
                label="Project"
                value={projectName(
                  projects,
                  subsystems.find((s) => s.id === activeDef.subsystemId)?.projectId,
                )}
              />
            )}
            <Stat label="Subsystem" value={getSubsystemName(activeDef.subsystemId)} />
            <Stat label="Instances" value={activeInstances.length} />
          </div>
        </Card>
      </>
    </Page>
  );
}
