import type { LocationRow, StockView } from "@g3/worker-inventory";

// Where parts can be: the team's tree of locations (at most four levels), its robots and its
// subsystems.

export const MAX_DEPTH = 4;

export type Named = { id: number; name: string };

export type Places = {
  locations: LocationRow[];
  byId: Map<number, LocationRow>;
  childrenOf: Map<number | null, LocationRow[]>;
  robots: Named[];
  subsystems: Named[];
};

export function indexPlaces(
  locations: LocationRow[],
  robots: Named[],
  subsystems: Named[],
): Places {
  const byId = new Map(locations.map((row) => [row.id, row]));
  const childrenOf = new Map<number | null, LocationRow[]>();
  for (const row of locations) {
    const list = childrenOf.get(row.parentId);
    if (list) list.push(row);
    else childrenOf.set(row.parentId, [row]);
  }
  return { locations, byId, childrenOf, robots, subsystems };
}

/** The location and what it's inside, from the top down. */
export function pathOf(id: number | null, places: Places): LocationRow[] {
  const path: LocationRow[] = [];
  for (let at = id === null ? undefined : places.byId.get(id); at && path.length <= MAX_DEPTH; ) {
    path.unshift(at);
    at = at.parentId === null ? undefined : places.byId.get(at.parentId);
  }
  return path;
}

/** "Dungeon › A1" */
export const locationLabel = (id: number | null, places: Places) =>
  pathOf(id, places)
    .map((row) => row.name)
    .join(" › ");

/** "Comp bot · Drivetrain" for parts in use, "" for parts in storage. */
export function useLabel(
  row: Pick<StockView, "status" | "robotId" | "subsystemId">,
  places: Places,
): string {
  if (row.status !== "in_use") return "";
  const robot = places.robots.find((r) => r.id === row.robotId)?.name ?? "?";
  const subsystem = places.subsystems.find((s) => s.id === row.subsystemId)?.name ?? "?";
  return `${robot} · ${subsystem}`;
}

/** Every location inside `id`, and `id` itself. */
export function withinLocation(id: number, places: Places): Set<number> {
  const out = new Set<number>();
  const visit = (at: number) => {
    if (out.has(at)) return;
    out.add(at);
    for (const child of places.childrenOf.get(at) ?? []) visit(child.id);
  };
  visit(id);
  return out;
}
