import type {
  IntakeRequest,
  IntakeResult,
  InventoryDestination,
  InventoryOptions,
} from "@g3/worker-inventory/intake-types";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { OrdersDb } from "../db";
import { appSettings } from "../db/schema";
import type { AppEnv } from "../types";
import { pricePerPart } from "./pack-quantity";

// Receiving a part can put it in the Inventory app: the person receiving it says where it's going
// (a storage location, or in use on a robot), and Orders passes that on with what was received.
//
// Inventory is an optional neighbour. Orders reaches it over the INVENTORY service binding with
// the person's own session, so Inventory decides what they may do. Without it, or with nothing
// said about where a part goes, receiving works as it always has and nothing reaches Inventory;
// unless a mentor has turned on the setting that makes the destination required.

const REQUIRED_KEY = "inventory_required";

/** Whether receiving a part must say where it goes in Inventory. Off unless a mentor turns it on. */
export async function inventoryRequired(db: OrdersDb): Promise<boolean> {
  const row = await db.select().from(appSettings).where(eq(appSettings.key, REQUIRED_KEY)).get();
  return row?.value === "true";
}

export async function setInventoryRequired(db: OrdersDb, required: boolean) {
  const value = required ? "true" : "false";
  await db
    .insert(appSettings)
    .values({ key: REQUIRED_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/** Where received parts go, and optionally how many of each request, when that isn't the usual. */
export type ReceiveDestination = InventoryDestination & {
  /**
   * Request id -> how many parts go into Inventory. Left out, it's the quantity ordered times the
   * request's pack quantity (1 pack of 4 is 4 parts).
   */
  quantities: Record<string, number>;
};

const positiveInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max;

/** The `inventory` part of a receive request: null when left out, or what's wrong with it. */
export function parseDestination(raw: unknown): ReceiveDestination | null | { error: string } {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    return { error: "inventory must be an object." };
  const v = raw as Record<string, unknown>;
  if (v.status !== "storage" && v.status !== "in_use") {
    return { error: "Say whether the parts go into storage or into use." };
  }
  if (!positiveInt(v.locationId)) return { error: "Pick where the parts go in Inventory." };
  const inUse = v.status === "in_use";
  if (inUse && !(positiveInt(v.robotId) && positiveInt(v.subsystemId))) {
    return { error: "Pick the robot and subsystem the parts are in use on." };
  }
  const quantities: Record<string, number> = {};
  if (v.quantities !== undefined && v.quantities !== null) {
    if (typeof v.quantities !== "object" || Array.isArray(v.quantities)) {
      return { error: "quantities must be an object of request id to quantity." };
    }
    for (const [id, quantity] of Object.entries(v.quantities as Record<string, unknown>)) {
      if (!positiveInt(quantity, 1_000_000)) {
        return { error: "A quantity going into Inventory must be a whole number, 1 or more." };
      }
      quantities[id] = quantity;
    }
  }
  return {
    status: v.status,
    locationId: v.locationId,
    robotId: inUse ? (v.robotId as number) : null,
    subsystemId: inUse ? (v.subsystemId as number) : null,
    quantities,
  };
}

const forwarded = (c: Context<AppEnv>) => ({ cookie: c.req.header("Cookie") ?? "" });

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

/**
 * Before requests are marked received: sends them to Inventory if a destination was given.
 * Gives back how many were added (null when nothing was sent), or why receiving can't go ahead.
 * Inventory adds each request once however often it's sent, so trying again is safe.
 */
export async function sendToInventory(
  c: Context<AppEnv>,
  db: OrdersDb,
  lines: ReceivedLine[],
  destination: ReceiveDestination | null,
): Promise<{ added: number | null } | { error: string; status: 400 | 502 | 503 }> {
  if (!destination) {
    if (await inventoryRequired(db)) {
      return { error: "Say where these parts go in Inventory.", status: 400 };
    }
    return { added: null };
  }
  if (!c.env.INVENTORY) return { error: "Inventory isn't connected to Orders here.", status: 503 };

  const { quantities, ...place } = destination;
  const added: IntakeResult["added"] = [];
  // Inventory takes 50 deliveries a call.
  for (let i = 0; i < lines.length; i += 50) {
    const body: IntakeRequest = {
      destination: place,
      lines: lines.slice(i, i + 50).map((line) => ({
        sourceKey: `orders:request:${line.id}`,
        // Inventory counts parts: a pack of 4 ordered once is 4.
        quantity: quantities[line.id] ?? line.quantity * line.packQuantity,
        name: line.title,
        listing: {
          catalogItemId: line.catalogItemId,
          vendor: line.vendor,
          sku: line.sku,
          url: line.url,
          // What one part cost: the final price of a unit (or an imported line's total split
          // evenly), over the parts in a unit.
          priceCents: pricePerPart(
            line.unitPriceCents ??
              (line.lineTotalCents === null
                ? null
                : Math.round(line.lineTotalCents / Math.max(1, line.quantity))),
            line.packQuantity,
          ),
          priceAt: null,
        },
        note: line.orderId === null ? line.vendor : `${line.vendor} order #${line.orderId}`,
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
  return { added: added.filter((line) => !line.duplicate).length };
}
