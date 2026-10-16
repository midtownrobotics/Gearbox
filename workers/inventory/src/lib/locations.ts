import { inTeam } from "@g3/auth";
import { asc } from "drizzle-orm";
import type { Db } from "../db";
import { locations } from "../db/schema";

// Locations are a tree: top-level places, each with places inside it, down to four levels
// (a room, a cabinet in it, a drawer in that, a bin in the drawer).

export const MAX_DEPTH = 4;
export const MAX_TITLE = 60;

export type LocationRow = {
  id: number;
  parentId: number | null;
  name: string;
  /** What's kept there, shown beside the name ("A1 - Misc. Electronics"). "" for none. */
  title: string;
};

/** Every location, in the order a tree lists them in: parents' order, then their own. */
export async function loadLocations(db: Db, team: string): Promise<LocationRow[]> {
  return db
    .select({
      id: locations.id,
      parentId: locations.parentId,
      name: locations.name,
      title: locations.title,
    })
    .from(locations)
    .where(inTeam(locations, team))
    .orderBy(asc(locations.sortOrder), asc(locations.id))
    .all();
}

export type LocationIndex = {
  byId: Map<number, LocationRow>;
  childrenOf: Map<number | null, LocationRow[]>;
};

export function indexLocations(rows: LocationRow[]): LocationIndex {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenOf = new Map<number | null, LocationRow[]>();
  for (const row of rows) {
    const list = childrenOf.get(row.parentId);
    if (list) list.push(row);
    else childrenOf.set(row.parentId, [row]);
  }
  return { byId, childrenOf };
}

/** The location and what it's inside, from the top down. */
export function pathOf(id: number, byId: Map<number, LocationRow>): LocationRow[] {
  const path: LocationRow[] = [];
  // The depth limit also stops a loop in bad data from running forever.
  for (let at = byId.get(id); at && path.length <= MAX_DEPTH; ) {
    path.unshift(at);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  return path;
}

/** The location and everything inside it, from the tree: its own id first. */
export function subtreeOf(id: number, childrenOf: Map<number | null, LocationRow[]>): number[] {
  const ids: number[] = [];
  const visit = (at: number, depth: number) => {
    ids.push(at);
    // The depth limit also stops a loop in bad data from running forever.
    if (depth >= MAX_DEPTH) return;
    for (const child of childrenOf.get(at) ?? []) visit(child.id, depth + 1);
  };
  visit(id, 1);
  return ids;
}

/** A location as people read it: its name, with its title when it has one ("A1 - Misc. Electronics"). */
export const labelOf = (row: Pick<LocationRow, "name" | "title">) =>
  row.title ? `${row.name} - ${row.title}` : row.name;

/** "Dungeon › A1 - Misc. Electronics" */
export const pathLabel = (id: number, byId: Map<number, LocationRow>) =>
  pathOf(id, byId).map(labelOf).join(" › ");

/** How many levels down a location is: 1 for a top-level one. */
export const depthOf = (id: number, byId: Map<number, LocationRow>) => pathOf(id, byId).length;
