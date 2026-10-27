import { inputClass } from "@g3/ui";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchProjects } from "./getters";
import type { PartDefinition, Project, Subsystem } from "./types";
import type { ShopData } from "./use-shop-data";

// The team's projects (a robot, a practice bot) and the project filter most pages have. A part's
// project is its subsystem's. The filter is in the address (`?project=<id>`), and the last one
// chosen is remembered in this browser, so the shop floor's screen stays on its robot. With one
// project there's nothing to choose and the filter isn't shown.

const REMEMBERED = "g3_shop_project";

let projects: Project[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Loads the team's projects again, for every page part that shows them. */
export function refreshProjects(): Promise<void> {
  loading ??= fetchProjects()
    .then((rows) => {
      projects = rows;
      for (const listener of listeners) listener();
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The team's projects, removed ones too (`archivedAt`); empty until they've loaded. */
export function useProjects(): Project[] {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => projects,
  );
  useEffect(() => {
    if (projects === null) refreshProjects();
  }, []);
  return current ?? [];
}

function remembered(): number | null {
  try {
    return Number(localStorage.getItem(REMEMBERED)) || null;
  } catch {
    return null;
  }
}

function remember(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(REMEMBERED);
    else localStorage.setItem(REMEMBERED, String(id));
  } catch {}
}

/**
 * The page's project filter: the chosen project's id, or null for all of them (also whenever the
 * team has only one project, or the one chosen is gone). `show` says whether to show the filter.
 */
export function useProjectFilter() {
  const all = useProjects();
  const [params, setParams] = useSearchParams();
  const inAddress = params.get("project");
  const wanted = inAddress !== null ? Number(inAddress) || null : remembered();
  const show = all.length > 1;
  const projectId = show && all.some((p) => p.id === wanted) ? wanted : null;

  const setProjectId = (id: number | null) => {
    remember(id);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id === null) next.delete("project");
        else next.set("project", String(id));
        return next;
      },
      { replace: true },
    );
  };
  return { projects: all, projectId, setProjectId, show };
}

/** Each subsystem's project. */
export const subsystemProjects = (subsystems: Subsystem[]) =>
  new Map(subsystems.map((s) => [s.id, s.projectId]));

/** Whether a part is in the chosen project (always, with none chosen). */
export function useInProject(subsystems: Subsystem[], projectId: number | null) {
  const projectOf = useMemo(() => subsystemProjects(subsystems), [subsystems]);
  return (definition: Pick<PartDefinition, "subsystemId"> | undefined) =>
    projectId === null ||
    (definition !== undefined && projectOf.get(definition.subsystemId) === projectId);
}

/**
 * The shop's data with only one project's parts: their definitions, instances and steps, and the
 * batches holding any of them (and empty ones, which hold no project's parts yet). Everything else
 * (projects, subsystems, processes) stays whole. With no project chosen, the data as it is.
 */
export function inProjectOnly(data: ShopData, projectId: number | null): ShopData {
  if (projectId === null) return data;
  const projectOf = subsystemProjects(data.subsystems);
  const definitions = data.definitions.filter((d) => projectOf.get(d.subsystemId) === projectId);
  const definitionIds = new Set(definitions.map((d) => d.id));
  const instances = data.instances.filter((i) => definitionIds.has(i.partDefinitionId));
  const instanceIds = new Set(instances.map((i) => i.id));
  return {
    ...data,
    definitions,
    instances,
    instanceProcesses: data.instanceProcesses.filter((s) => instanceIds.has(s.partInstanceId)),
    batches: data.batches.filter(
      (b) =>
        b.instances.length === 0 || b.instances.some((i) => definitionIds.has(i.partDefinitionId)),
    ),
  };
}

/** The shop's data in the page's chosen project (`inProjectOnly`), kept while it's the same. */
export function useDataInProject(data: ShopData | null, projectId: number | null) {
  return useMemo(() => (data ? inProjectOnly(data, projectId) : null), [data, projectId]);
}

/** A project's name, saying so when it was removed. */
export const projectLabel = (p: Project) =>
  p.archivedAt === null ? p.name : `${p.name} (removed)`;

/** The name of a project by id, for a column. */
export const projectName = (all: Project[], id: number | null | undefined) =>
  all.find((p) => p.id === id)?.name ?? "—";

/** The project filter: All projects, then each project. Shows nothing with one project. */
export function ProjectFilter({
  filter,
  className = "",
}: {
  filter: ReturnType<typeof useProjectFilter>;
  className?: string;
}) {
  if (!filter.show) return null;
  // Removed projects last.
  const listed = [...filter.projects].sort(
    (a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null),
  );
  return (
    <select
      aria-label="Project"
      value={filter.projectId ?? ""}
      onChange={(e) => filter.setProjectId(Number(e.target.value) || null)}
      className={`${inputClass} !w-auto max-w-full ${className}`}
    >
      <option value="">All projects</option>
      {listed.map((p) => (
        <option key={p.id} value={p.id}>
          {projectLabel(p)}
        </option>
      ))}
    </select>
  );
}
