import { env } from "cloudflare:test";
import { kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Receiving a part can put it in the Inventory app (lib/inventory.ts): the person receiving it
// says where it goes, and Orders passes that on before marking it received. A mentor can make
// that required. Inventory here is a stand-in (vitest.config.mts).
//
// The tests share one database and run in order.

const db = (env as unknown as { ORDERS_DB: D1Database }).ORDERS_DB;
const now = Date.now();

type Sent = {
  sourceKey: string;
  quantity: number;
  name: string;
  listing: {
    catalogItemId: number | null;
    vendor: string;
    sku: string | null;
    priceCents: number | null;
  };
  note: string | null;
  locationId?: number;
};
type Intake = {
  required: boolean;
  options: { locations: { id: number; name: string }[]; robots: unknown[]; sent: Sent[] } | null;
};
type Received = { received: number[]; skipped: number[]; inventoryAdded: number | null };

/** One request on a placed WCP order, asked for by the student. Gives back its id. */
async function ordered(part: {
  title: string;
  quantity?: number;
  catalogItemId?: number;
  /** How many parts one of the quantity is. */
  packQuantity?: number;
}) {
  const category = await db
    .prepare(
      "INSERT INTO budget_categories (team_id, name, created_at) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(student.teamId, `Inventory ${crypto.randomUUID()}`, now)
    .first<{ id: number }>();
  const order = await db
    .prepare(
      "INSERT INTO vendor_orders (team_id, vendor, placed_by_id, placed_by_name, placed_at) VALUES (?, 'WCP', ?, 'Mentor', ?) RETURNING id",
    )
    .bind(student.teamId, mentor.id, now)
    .first<{ id: number }>();
  const row = await db
    .prepare(
      `INSERT INTO order_requests (team_id, requester_id, requester_name, url, vendor, title, sku, quantity,
         pack_quantity, unit_price_cents, catalog_item_id, category_id, reason, status, order_id,
         created_at, updated_at)
       VALUES (?, ?, 'Sam Student', ?, 'WCP', ?, 'WCP-0500', ?, ?, 1299, ?, ?, 'test', 'ordered', ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      student.teamId,
      student.id,
      `https://wcproducts.com/products/${crypto.randomUUID()}`,
      part.title,
      part.quantity ?? 1,
      part.packQuantity ?? 1,
      part.catalogItemId ?? null,
      category?.id,
      order?.id,
      now,
      now,
    )
    .first<{ id: number }>();
  return { id: row?.id as number, orderId: order?.id as number };
}

const statusOf = async (id: number) =>
  (
    await db
      .prepare("SELECT status FROM order_requests WHERE id = ?")
      .bind(id)
      .first<{ status: string }>()
  )?.status;
const sentFor = async (id: number) =>
  (await jsonAs<Intake>(student, "/inventory")).options?.sent.filter(
    (line) => line.sourceKey === `orders:request:${id}`,
  ) ?? [];
const receive = (user: typeof student, body: unknown) =>
  callAs(user, "/orders/receive", { method: "POST", body });
const storage = { status: "storage", locationId: 2 };

describe("where received parts go", () => {
  it("offers Inventory's places, and isn't required until a mentor says so", async () => {
    const intake = await jsonAs<Intake>(student, "/inventory");
    expect(intake.required).toBe(false);
    expect(intake.options?.locations.map((l) => l.name)).toEqual(["Shop", "Bin 2", "Bin 3"]);
    expect(await jsonAs(student, "/settings")).toMatchObject({ inventoryRequired: false });
  });

  it("receives as before when nothing is said about Inventory", async () => {
    const { id } = await ordered({ title: "Plain bolt" });
    const res = await jsonAs<Received>(student, "/orders/receive", {
      method: "POST",
      body: { ids: [id] },
    });
    expect(res).toMatchObject({ received: [id], inventoryAdded: null });
    expect(await sentFor(id)).toEqual([]);
  });

  it("adds received parts to Inventory when told where they go", async () => {
    const pinion = await ordered({ title: "Falcon pinion 14t", quantity: 3, catalogItemId: 900 });
    // A pack of 50 ordered as 1: the person receiving says how many parts that is.
    const zipTies = await ordered({ title: "Zip ties (50 pack)" });
    const res = await jsonAs<Received>(mentor, "/orders/receive", {
      method: "POST",
      body: {
        ids: [pinion.id, zipTies.id],
        inventory: { ...storage, quantities: { [zipTies.id]: 50 } },
      },
    });
    expect(res.received.sort()).toEqual([pinion.id, zipTies.id].sort());
    expect(res.inventoryAdded).toBe(2);

    expect(await sentFor(pinion.id)).toMatchObject([
      {
        quantity: 3,
        name: "Falcon pinion 14t",
        listing: { catalogItemId: 900, vendor: "WCP", sku: "WCP-0500", priceCents: 1299 },
        note: `WCP order #${pinion.orderId}`,
      },
    ]);
    expect(await sentFor(zipTies.id)).toMatchObject([{ quantity: 50 }]);

    const detail = await jsonAs<{ events: { action: string; note: string | null }[] }>(
      student,
      `/requests/${pinion.id}`,
    );
    expect(detail.events.find((e) => e.action === "received")?.note).toBe("Added to Inventory.");
  });

  it("lets anyone signed in receive, a kiosk included, with their own session", async () => {
    // Packages are opened by whoever is in the shop, not only who asked for the part.
    const other = await ordered({ title: "Someone else's part" });
    expect((await receive(otherStudent, { ids: [other.id], inventory: storage })).status).toBe(200);
    expect(await statusOf(other.id)).toBe("received");
    expect(await sentFor(other.id)).toHaveLength(1);

    const kiosk = await ordered({ title: "Kiosk part" });
    const res = await callAs(kioskAdmin, `/requests/${kiosk.id}/receive`, {
      method: "POST",
      body: { inventory: storage },
    });
    expect(res.status).toBe(200);
    expect(await statusOf(kiosk.id)).toBe("received");
    expect((await call("/orders/receive", { method: "POST" })).status).toBe(401);

    // Receiving is all that opened up: approving and placing orders are still mentors'.
    const waiting = await ordered({ title: "Still mentors' business" });
    await db
      .prepare("UPDATE order_requests SET status = 'requested' WHERE id = ?")
      .bind(waiting.id)
      .run();
    for (const user of [otherStudent, kioskAdmin]) {
      expect(
        (await callAs(user, `/requests/${waiting.id}/approve`, { method: "POST", body: {} }))
          .status,
      ).toBe(403);
      expect(
        (
          await callAs(user, "/orders", {
            method: "POST",
            body: {
              vendor: "WCP",
              lines: [{ requestId: waiting.id, quantity: 1, unitPriceCents: 100 }],
              shippingCents: 0,
              taxCents: 0,
              tracking: null,
            },
          })
        ).status,
      ).toBe(403);
    }
    expect(await statusOf(waiting.id)).toBe("requested");
  });

  it("puts packs into Inventory as the parts in them", async () => {
    // Two packs of 4 wheels at $12.99 a pack: 8 parts, about $3.25 each.
    const wheels = await ordered({ title: "ION flap wheel", quantity: 2, packQuantity: 4 });
    await jsonAs<Received>(student, "/orders/receive", {
      method: "POST",
      body: { ids: [wheels.id], inventory: storage },
    });
    expect(await sentFor(wheels.id)).toMatchObject([{ quantity: 8, listing: { priceCents: 325 } }]);
    // What the person receiving says arrived still wins.
    const short = await ordered({ title: "Short pack", quantity: 1, packQuantity: 10 });
    await jsonAs<Received>(student, "/orders/receive", {
      method: "POST",
      body: { ids: [short.id], inventory: { ...storage, quantities: { [short.id]: 9 } } },
    });
    expect(await sentFor(short.id)).toMatchObject([{ quantity: 9 }]);
    // The Receiving page says what's a pack.
    const page = await jsonAs<{
      recent: { lines: { id: number; quantity: number; packQuantity: number }[] }[];
    }>(student, "/orders/receiving");
    const line = page.recent.flatMap((o) => o.lines).find((l) => l.id === wheels.id);
    expect(line).toMatchObject({ quantity: 2, packQuantity: 4 });
  });

  it("marks nothing received when Inventory refuses or is down", async () => {
    const { id } = await ordered({ title: "Stuck part" });
    // A location that's gone: theirs to fix.
    const gone = await receive(student, { ids: [id], inventory: { ...storage, locationId: 404 } });
    expect(gone.status).toBe(400);
    expect(await gone.json()).toEqual({ error: "Pick a location." });
    const down = await receive(student, { ids: [id], inventory: { ...storage, locationId: 500 } });
    expect(down.status).toBe(502);
    expect(await statusOf(id)).toBe("ordered");
    // And then it works.
    expect((await receive(student, { ids: [id], inventory: storage })).status).toBe(200);
    expect(await statusOf(id)).toBe("received");
  });

  it("checks what it's told", async () => {
    const { id } = await ordered({ title: "Checked part" });
    for (const inventory of [
      { status: "lost", locationId: 2 },
      { status: "storage" },
      { status: "in_use", locationId: 2 },
      { status: "in_use", locationId: 2, robotId: 1 },
      { ...storage, quantities: { [id]: 0 } },
      "storage",
    ]) {
      expect((await receive(student, { ids: [id], inventory })).status).toBe(400);
    }
    expect(await statusOf(id)).toBe("ordered");
    const inUse = { status: "in_use", locationId: 1, robotId: 1, subsystemId: 1 };
    expect((await receive(student, { ids: [id], inventory: inUse })).status).toBe(200);
  });
});

describe("requiring it", () => {
  it("is a mentor's setting", async () => {
    const put = (user: typeof student, body: unknown) =>
      callAs(user, "/settings", { method: "PUT", body });
    expect((await put(student, { inventoryRequired: true })).status).toBe(403);
    expect((await put(mentor, { inventoryRequired: "yes" })).status).toBe(400);
    expect((await put(mentor, {})).status).toBe(400);

    const before = await jsonAs<{ namingTemplate: string }>(student, "/settings");
    expect(
      await jsonAs(mentor, "/settings", { method: "PUT", body: { inventoryRequired: true } }),
    ).toMatchObject({ namingTemplate: before.namingTemplate, inventoryRequired: true });
    expect((await jsonAs<Intake>(student, "/inventory")).required).toBe(true);
    // The naming template is still saved on its own.
    expect(
      await jsonAs(mentor, "/settings", {
        method: "PUT",
        body: { namingTemplate: "{vendor}: {title}" },
      }),
    ).toMatchObject({ namingTemplate: "{vendor}: {title}", inventoryRequired: true });
  });

  it("then refuses to receive without saying where the parts go", async () => {
    const { id } = await ordered({ title: "Required part" });
    const res = await receive(student, { ids: [id] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Say where these parts go in Inventory." });
    // The request's own page asks the same.
    const one = await callAs(student, `/requests/${id}/receive`, { method: "POST", body: {} });
    expect(one.status).toBe(400);
    expect(await statusOf(id)).toBe("ordered");

    const done = await callAs(student, `/requests/${id}/receive`, {
      method: "POST",
      body: { inventory: { ...storage, quantities: { [id]: 4 } } },
    });
    expect(done.status).toBe(200);
    expect(await statusOf(id)).toBe("received");
    expect(await sentFor(id)).toMatchObject([{ quantity: 4 }]);
  });

  it("can be turned off again", async () => {
    await jsonAs(mentor, "/settings", { method: "PUT", body: { inventoryRequired: false } });
    const { id } = await ordered({ title: "Optional again" });
    expect((await receive(student, { ids: [id] })).status).toBe(200);
  });
});

describe("where each part goes", () => {
  type Defaults = {
    defaults: Record<
      string,
      { locationId: number; from: "entry" | "history"; entryName: string | null }
    >;
  };
  const defaultsFor = (ids: number[]) =>
    jsonAs<Defaults>(student, "/inventory/defaults", { method: "POST", body: { ids } });
  const placeOf = async (id: number) =>
    (
      await db
        .prepare("SELECT inventory_location_id AS place FROM order_requests WHERE id = ?")
        .bind(id)
        .first<{ place: number | null }>()
    )?.place;

  it("can be a different place for each, and is remembered", async () => {
    const a = await ordered({ title: "Goes in bin 2" });
    const b = await ordered({ title: "Goes in bin 3" });
    const c = await ordered({ title: "Goes with the rest" });
    const res = await jsonAs<Received>(student, "/orders/receive", {
      method: "POST",
      body: {
        ids: [a.id, b.id, c.id],
        // One place for the rest, and their own for two of them.
        inventory: { status: "storage", locationId: 1, locations: { [a.id]: 2, [b.id]: 3 } },
      },
    });
    expect(res.inventoryAdded).toBe(3);
    expect(await sentFor(a.id)).toMatchObject([{ locationId: 2 }]);
    expect(await sentFor(b.id)).toMatchObject([{ locationId: 3 }]);
    expect(await sentFor(c.id)).toMatchObject([{ locationId: 1 }]);
    expect([await placeOf(a.id), await placeOf(b.id), await placeOf(c.id)]).toEqual([2, 3, 1]);
  });

  it("has to be said for every part", async () => {
    const a = await ordered({ title: "Has a place" });
    const b = await ordered({ title: "Has none" });
    const res = await receive(student, {
      ids: [a.id, b.id],
      inventory: { status: "storage", locations: { [a.id]: 2 } },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick where “Has none” goes in Inventory." });
    expect(await statusOf(a.id)).toBe("ordered");
    expect(await sentFor(a.id)).toEqual([]);
    expect(await placeOf(a.id)).toBeNull();
    // Nothing is remembered for parts received without Inventory.
    await jsonAs(student, "/orders/receive", { method: "POST", body: { ids: [a.id, b.id] } });
    expect(await placeOf(a.id)).toBeNull();
  });

  it("starts with the part's entry in Inventory, else where it went last time, else nothing", async () => {
    // Catalog part 901 is one Inventory already keeps, in location 2.
    const known = await ordered({ title: "Known bearing", catalogItemId: 901 });
    // Catalog part 902 isn't in Inventory, but one was received into location 3 before.
    const before = await ordered({ title: "Seen before", catalogItemId: 902 });
    await callAs(student, `/requests/${before.id}/receive`, {
      method: "POST",
      body: { inventory: { status: "storage", locationId: 3 } },
    });
    expect(await placeOf(before.id)).toBe(3);
    const again = await ordered({ title: "Seen before", catalogItemId: 902 });
    const fresh = await ordered({ title: "Never seen", catalogItemId: 903 });
    const loose = await ordered({ title: "Not in the catalog" });

    const { defaults } = await defaultsFor([known.id, again.id, fresh.id, loose.id]);
    expect(defaults).toEqual({
      [known.id]: { locationId: 2, from: "entry", entryName: "Known bearing" },
      [again.id]: { locationId: 3, from: "history", entryName: null },
    });
    // The latest place wins: received somewhere else now, that's where the next one starts.
    await jsonAs(student, "/orders/receive", {
      method: "POST",
      body: { ids: [again.id], inventory: { status: "storage", locationId: 2 } },
    });
    const next = await ordered({ title: "Seen before", catalogItemId: 902 });
    expect((await defaultsFor([next.id])).defaults[next.id]).toMatchObject({
      locationId: 2,
      from: "history",
    });

    expect((await call("/inventory/defaults", { method: "POST" })).status).toBe(401);
    expect(
      (await callAs(student, "/inventory/defaults", { method: "POST", body: { ids: [] } })).status,
    ).toBe(400);
  });
});
