import { forwardIdentity, inTeam } from "@g3/auth";
import type {
  IntakeRequest,
  IntakeResult,
  InventoryOptions,
  PlacesRequest,
  PlacesResult,
} from "@g3/worker-inventory/intake-types";
import { desc, inArray, isNotNull } from "drizzle-orm";
import type { Context } from "hono";
import type { OrdersDb } from "../db";
import { orderRequests } from "../db/schema";
import type { AppEnv } from "../types";
import { inChunks } from "./chunks";
import { pricePerPart } from "./pack-quantity";
import { teamSettings } from "./settings";

// Receiving a part can put it in the Inventory app: the person receiving it says where it's going
// (a storage location, or in use on a robot), and Orders passes that on with what was received.
//
// Inventory is an optional neighbour. Orders reaches it over the INVENTORY service binding with
// the person's own session, so Inventory decides what they may do. Without it, or with nothing
// said about where a part goes, receiving works as it always has and nothing reaches Inventory;
// unless a mentor has turned on the setting that makes the destination required.

/** Whether receiving a part must say where it goes in Inventory. Off unless a mentor turns it on. */
export async function inventoryRequired(db: OrdersDb, teamId: string): Promise<boolean> {
  return (await teamSettings(db, teamId)).inventoryRequired;
}

/**
 * Where received parts go. They all go into storage, or all into use on one robot's subsystem;
 * each request can have its own location.
 */
export type ReceiveDestination = {
  status: "storage" | "in_use";
  robotId: number | null;
  subsystemId: number | null;
  /** The location for requests that don't have their own in `locations`. */
  locationId: number | null;
  /** Request id -> the location its parts go to. */
  locations: Record<string, number>;
  /**
   * Request id -> how many parts go into Inventory. Left out, it's the quantity ordered times the
   * request's pack quantity (1 pack of 4 is 4 parts).
   */
  quantities: Record<string, number>;
};

const positiveInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max;

/** A `{ request id: number }` object from a request body, or null if it isn't one. */
function numbersById(raw: unknown, max?: number): Record<string, number> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!positiveInt(value, max)) return null;
    out[id] = value;
  }
  return out;
}

/** The `inventory` part of a receive request: null when left out, or what's wrong with it. */
export function parseDestination(raw: unknown): ReceiveDestination | null | { error: string } {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    return { error: "inventory must be an object." };
  const v = raw as Record<string, unknown>;
  if (v.status !== "storage" && v.status !== "in_use") {
    return { error: "Say whether the parts go into storage or into use." };
  }
  const shared = v.locationId === undefined || v.locationId === null ? null : v.locationId;
  if (shared !== null && !positiveInt(shared)) {
    return { error: "Pick where the parts go in Inventory." };
  }
  const locations = numbersById(v.locations);
  if (locations === null)
    return { error: "locations must be an object of request id to location." };
  if (shared === null && Object.keys(locations).length === 0) {
    return { error: "Pick where the parts go in Inventory." };
  }
  const inUse = v.status === "in_use";
  if (inUse && !(positiveInt(v.robotId) && positiveInt(v.subsystemId))) {
    return { error: "Pick the robot and subsystem the parts are in use on." };
  }
  const quantities = numbersById(v.quantities, 1_000_000);
  if (quantities === null) {
    return { error: "A quantity going into Inventory must be a whole number, 1 or more." };
  }
  return {
    status: v.status,
    locationId: shared,
    locations,
    robotId: inUse ? (v.robotId as number) : null,
    subsystemId: inUse ? (v.subsystemId as number) : null,
    quantities,
  };
}

/** The member's session and the request's team: Inventory acts for the same person, in their team. */
const forwarded = (c: Context<AppEnv>) => forwardIdentity(c);

/** Inventory's locations, robots and subsystems, or null if it can't be reached. */
export async function inventoryOptions(c: Context<AppEnv>): Promise<InventoryOptions | null> {
  if (!c.env.INVENTORY) return null;
  try {
    const res = await c.env.INVENTORY.fetch("http://inventory/api/options", {
      headers: forwarded(c),
    });
    return res.ok ? ((await res.json()) as InventoryOptions) : null;
  } catch (err) {
    console.error("[orders] inventory options", err);
    return null;
  }
}

/** A request, as much of it as Inventory is told. */
export type ReceivedLine = {
  id: number;
  title: string;
  vendor: string;
  sku: string | null;
  url: string;
  quantity: number;
  /** How many parts one of `quantity` is. */
  packQuantity: number;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  catalogItemId: number | null;
  orderId: number | null;
};

const sourceKey = (line: Pick<ReceivedLine, "id">) => `orders:request:${line.id}`;

/** How Inventory recognises a request's part: by its catalog part, vendor and part number, or link. */
const listingOf = (line: ReceivedLine) => ({
  catalogItemId: line.catalogItemId,
  vendor: line.vendor,
  sku: line.sku,
  url: line.url,
  // What one part cost: the final price of a unit (or an imported line's total split evenly),
  // over the parts in a unit.
  priceCents: pricePerPart(
    line.unitPriceCents ??
      (line.lineTotalCents === null
        ? null
        : Math.round(line.lineTotalCents / Math.max(1, line.quantity))),
    line.packQuantity,
  ),
  priceAt: null,
});

/** Inventory takes this many deliveries (or parts to look up) a call. */
const INVENTORY_BATCH = 50;

/**
 * Where a request's parts would go if nobody said otherwise: with the entry Inventory already has
 * for the part, else where the same part went the last time it was received.
 */
export type InventoryDefault = {
  locationId: number;
  /** "entry": Inventory has the part there now. "history": it went there last time. */
  from: "entry" | "history";
  /** The Inventory entry's name, when there is one. */
  entryName: string | null;
};

/** The default place for each request that has one, by request id. Never fails: no answer, no default. */
export async function inventoryDefaults(
  c: Context<AppEnv>,
  db: OrdersDb,
  lines: ReceivedLine[],
): Promise<Record<string, InventoryDefault>> {
  const out: Record<string, InventoryDefault> = {};

  // 1. With the entry Inventory already has for the part.
  if (c.env.INVENTORY) {
    try {
      for (let i = 0; i < lines.length; i += INVENTORY_BATCH) {
        const body: PlacesRequest = {
          lines: lines
            .slice(i, i + INVENTORY_BATCH)
            .map((line) => ({ sourceKey: sourceKey(line), listing: listingOf(line) })),
        };
        const res = await c.env.INVENTORY.fetch("http://inventory/api/intake/places", {
          method: "POST",
          headers: { ...forwarded(c), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) break;
        for (const place of ((await res.json()) as PlacesResult).places) {
          if (place.locationId === null) continue;
          out[place.sourceKey.slice("orders:request:".length)] = {
            locationId: place.locationId,
            from: "entry",
            entryName: place.itemName,
          };
        }
      }
    } catch (err) {
      console.error("[orders] inventory places", err);
    }
  }

  // 2. Where the same catalog part went the last time one was received.
  const catalogIds = [
    ...new Set(
      lines
        .filter((line) => !out[line.id] && line.catalogItemId !== null)
        .map((line) => line.catalogItemId as number),
    ),
  ];
  if (catalogIds.length > 0) {
    const past = await inChunks(catalogIds, (chunk) =>
      db
        .select({
          catalogItemId: orderRequests.catalogItemId,
          locationId: orderRequests.inventoryLocationId,
          updatedAt: orderRequests.updatedAt,
        })
        .from(orderRequests)
        .where(
          inTeam(
            orderRequests,
            c.get("teamId"),
            inArray(orderRequests.catalogItemId, chunk),
            isNotNull(orderRequests.inventoryLocationId),
          ),
        )
        .orderBy(desc(orderRequests.updatedAt))
        .all(),
    );
    const latest = new Map<number, number>();
    for (const row of past.sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (row.catalogItemId !== null && row.locationId !== null && !latest.has(row.catalogItemId)) {
        latest.set(row.catalogItemId, row.locationId);
      }
    }
    for (const line of lines) {
      const locationId = line.catalogItemId === null ? undefined : latest.get(line.catalogItemId);
      if (!out[line.id] && locationId !== undefined) {
        out[line.id] = { locationId, from: "history", entryName: null };
      }
    }
  }
  return out;
}

/**
 * Before requests are marked received: sends them to Inventory if a destination was given.
 * Gives back how many were added (null when nothing was sent) and where each went, or why
 * receiving can't go ahead. Inventory adds each request once however often it's sent, so trying
 * again is safe.
 */
export async function sendToInventory(
  c: Context<AppEnv>,
  db: OrdersDb,
  lines: ReceivedLine[],
  destination: ReceiveDestination | null,
): Promise<
  | { added: number | null; locations: Map<number, number> }
  | { error: string; status: 400 | 502 | 503 }
> {
  const locations = new Map<number, number>();
  if (!destination) {
    if (await inventoryRequired(db, c.get("teamId"))) {
      return { error: "Say where these parts go in Inventory.", status: 400 };
    }
    return { added: null, locations };
  }
  for (const line of lines) {
    const locationId = destination.locations[line.id] ?? destination.locationId;
    if (locationId === null) {
      return { error: `Pick where “${line.title}” goes in Inventory.`, status: 400 };
    }
    locations.set(line.id, locationId);
  }
  if (!c.env.INVENTORY) return { error: "Inventory isn't connected to Orders here.", status: 503 };

  const { status, robotId, subsystemId, quantities } = destination;
  const added: IntakeResult["added"] = [];
  for (let i = 0; i < lines.length; i += INVENTORY_BATCH) {
    const body: IntakeRequest = {
      destination: { status, robotId, subsystemId },
      lines: lines.slice(i, i + INVENTORY_BATCH).map((line) => ({
        sourceKey: sourceKey(line),
        // Inventory counts parts: a pack of 4 ordered once is 4.
        quantity: quantities[line.id] ?? line.quantity * line.packQuantity,
        name: line.title,
        listing: listingOf(line),
        note: line.orderId === null ? line.vendor : `${line.vendor} order #${line.orderId}`,
        locationId: locations.get(line.id),
      })),
    };
    let res: Response;
    try {
      res = await c.env.INVENTORY.fetch("http://inventory/api/intake", {
        method: "POST",
        headers: { ...forwarded(c), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("[orders] inventory intake", err);
      return { error: "Inventory can't be reached right now. Nothing was received.", status: 503 };
    }
    if (!res.ok) {
      const problem = await res
        .json()
        .then((b) => (b as { error?: string }).error)
        .catch(() => undefined);
      // What the person picked was refused (a location that's gone): theirs to fix.
      if (res.status === 400) {
        return { error: problem ?? "Inventory didn't accept where these go.", status: 400 };
      }
      return {
        error: `Inventory couldn't take these parts${problem ? `: ${problem}` : "."} Nothing was received.`,
        status: 502,
      };
    }
    added.push(...((await res.json()) as IntakeResult).added);
  }
  return { added: added.filter((line) => !line.duplicate).length, locations };
}
