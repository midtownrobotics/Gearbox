import { env } from "cloudflare:test";
import { type Seeded, checkIsolation, checkTeamDeletion } from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";

// Two teams, each with its own arrangement (fields, locations, robots, subsystems), an entry with
// parts in storage and in use, a vendor listing and a delivery from Orders. Every route, called as
// team A's admin, mentor, student and kiosk session with team B's ids, must show none of B's and
// change nothing of B's.

const database = (env as unknown as { INVENTORY_DB: D1Database }).INVENTORY_DB;
const TABLES = [
  "fields",
  "locations",
  "robots",
  "subsystems",
  "items",
  "item_listings",
  "stock",
  "item_events",
  "intake_receipts",
];

type Named = { id: number; name: string };
type Inventory = {
  fields: Named[];
  locations: Named[];
  robots: Named[];
  subsystems: Named[];
  items: { id: number; name: string; stock: { id: number; status: string }[]; listings: Named[] }[];
};

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = `T${crypto.randomUUID().slice(0, 8)}`;
  const setup = {
    format: "gearbox-inventory-setup",
    version: 1,
    fields: [{ name: `Field ${tag}`, type: "text" }],
    locations: [{ name: `Room ${tag}`, children: [`Bin ${tag}`] }],
    robots: [`Robot ${tag}`],
    subsystems: [`Sub ${tag}`],
  };
  expect((await callAs(team.admin, "/setup/import", { method: "POST", body: setup })).status).toBe(
    200,
  );
  const before = await jsonAs<Inventory>(team.student, "/inventory");
  const [room, bin] = before.locations;
  const robot = before.robots[0];
  const subsystem = before.subsystems[0];
  const listing = { vendor: `Vendor ${tag}`, sku: `SKU-${tag}` };
  const made = await jsonAs<{ id: number }>(
    team.student,
    "/items",
    {
      method: "POST",
      body: { name: `Part ${tag}`, stock: { quantity: 9, locationId: bin.id }, listing },
    },
    201,
  );
  // A second listing, so a split has something to split off; and some parts in use.
  await callAs(team.student, `/items/${made.id}/listings`, {
    method: "POST",
    body: { vendor: `Other ${tag}`, sku: `ALT-${tag}` },
  });
  const storageRow = (await jsonAs<Inventory>(team.student, "/inventory")).items[0].stock[0];
  await callAs(team.student, `/stock/${storageRow.id}/check-out`, {
    method: "POST",
    body: { quantity: 2, locationId: room.id, robotId: robot.id, subsystemId: subsystem.id },
  });
  // A delivery from Orders.
  await callAs(team.student, "/intake", {
    method: "POST",
    body: {
      destination: { status: "storage", locationId: bin.id },
      lines: [{ sourceKey: `orders:request:${tag}`, quantity: 1, name: "", listing }],
    },
  });
  const after = await jsonAs<Inventory>(team.student, "/inventory");
  const item = after.items[0];
  const ids: Record<string, number> = {
    items: item.id,
    stock: item.stock[0].id,
    fields: after.fields[0].id,
    locations: bin.id,
    robots: robot.id,
    subsystems: subsystem.id,
  };
  return {
    params: (path, name) => {
      if (name === "listingId") return String(item.listings[1].id);
      if (name === "id") return String(ids[path.split("/")[1]] ?? 1);
      return undefined;
    },
    markers: [tag],
    data: {
      item: item.id,
      listing: item.listings[1].id,
      stock: item.stock[0].id,
      room: room.id,
      bin: bin.id,
      robot: robot.id,
      subsystem: subsystem.id,
      field: after.fields[0].id,
      listingInput: listing,
      tag,
    },
  };
}

async function snapshot(teamId: string) {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) {
    out[table] = (
      await database
        .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY id`)
        .bind(teamId)
        .all()
    ).results;
  }
  return out;
}

it("keeps every team's inventory to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    bodies: (b) => {
      const d = b.data as Record<string, number> & { listingInput: unknown; tag: string };
      return {
        "PATCH /items/:id": { name: "Renamed" },
        "POST /items/:id/stock": { quantity: 1, locationId: d.bin },
        "POST /items/:id/listings": { vendor: "Someone" },
        "POST /items/:id/merge": { fromId: d.item },
        "POST /items/:id/split": {
          listingId: d.listing,
          stock: [{ stockId: d.stock, quantity: 1 }],
        },
        "PATCH /stock/:id": { quantity: 0, locationId: d.room },
        "POST /stock/:id/check-out": {
          quantity: 1,
          locationId: d.room,
          robotId: d.robot,
          subsystemId: d.subsystem,
        },
        "POST /stock/:id/check-in": { quantity: 1, locationId: d.bin },
        "PATCH /fields/:id": { name: "Renamed" },
        "PUT /fields/order": { ids: [d.field] },
        "POST /locations": { parentId: d.room, names: ["Inside"] },
        "PATCH /locations/:id": { name: "Renamed", parentId: d.room },
        "PUT /locations/order": { ids: [d.room, d.bin] },
        "PUT /locations/:id/title": { title: "Mine now" },
        "POST /locations/:id/move-contents": { toLocationId: d.room },
        "PATCH /robots/:id": { name: "Renamed" },
        "PUT /robots/order": { ids: [d.robot] },
        "PATCH /subsystems/:id": { name: "Renamed" },
        "PUT /subsystems/order": { ids: [d.subsystem] },
        // Team B's part number: A's Inventory must neither find B's entry nor say where it's kept.
        "POST /intake/places": { lines: [{ sourceKey: "k", listing: d.listingInput }] },
        "POST /intake": {
          destination: { status: "storage", locationId: d.bin },
          lines: [{ sourceKey: `orders:request:${d.tag}`, quantity: 1, listing: d.listingInput }],
        },
      };
    },
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(100);
});

it("deletes a team's data when an operator deletes the team, and only that team's", async () => {
  const problems = await checkTeamDeletion({
    seed,
    snapshot,
    // As the platform calls it, over the service binding (the gateway never answers /internal).
    remove: (teamId) => call(`/internal/teams/${teamId}`, { method: "DELETE" }),
  });
  expect(problems).toEqual([]);
}, 60_000);
