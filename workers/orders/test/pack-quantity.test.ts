import { mentor, otherStudent, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { guessPack, guessPackQuantity, pricePerPart } from "../src/lib/pack-quantity";

// Pack quantity: how many parts one unit of a product is. A request carries it, the catalog part
// remembers it, and a product's name can suggest it.

type Request = { id: number; packQuantity: number; packUnit: string; catalogItemId: number };
type CatalogItem = { id: number; packQuantity: number; packUnit: string };
type Suggestion = {
  packQuantity: number | null;
  packUnit: string | null;
  packQuantityGuess: number | null;
  packUnitGuess: string | null;
};

const body = (url: string, extra: Record<string, unknown> = {}) => ({
  url,
  title: '4" ION Flap Wheel (30A, 1/2" Hex Bore)',
  quantity: 1,
  unitPriceCents: 1750,
  reason: "Intake rollers",
  catalogCategory: "Wheels",
  ...extra,
});

const catalogItem = async (id: number) =>
  (await jsonAs<{ items: CatalogItem[] }>(student, "/catalog")).items.find(
    (item) => item.id === id,
  ) as CatalogItem;

describe("reading it from a product's name", () => {
  it("knows how vendors write a pack", () => {
    for (const [name, pack] of [
      ['4" ION Flap Wheel (30A, 1/2" Hex Bore) PK4', 4],
      ["#10-32 x 0.5 Socket Head Screw (50 Pack)", 50],
      ["Zip Ties 8in, 100-pack", 100],
      ["M3 Heat Set Inserts, 25 pcs", 25],
      ["Wago 221 Lever Nuts, Box of 50", 50],
      ["Spacer Kit - Set of 2", 2],
      ["Ring Terminals 10ct", 10],
    ] as const) {
      expect(guessPackQuantity(name), name).toBe(pack);
    }
  });

  it("doesn't see one where there isn't", () => {
    for (const name of [
      '4" ION Flap Wheel (30A, 1/2" Hex Bore)',
      "Kraken X60 Motor",
      "Battery Pack 12V 18Ah",
      "NEO 550 Brushless Motor (1 Pack)",
      "1/4-20 x 2 Bolt",
    ]) {
      expect(guessPackQuantity(name), name).toBeNull();
    }
  });

  it("reads an amount in a unit, and a count before it", () => {
    for (const [name, pack] of [
      ["Silicone Wire 22 AWG, Red, 25 ft", { quantity: 25, unit: "ft" }],
      ["Paracord 550, 100' spool", { quantity: 100, unit: "ft" }],
      ["PLA Filament 1.75mm, 1kg spool", { quantity: 1, unit: "kg" }],
      ["LED Strip 5m", { quantity: 5, unit: "m" }],
      ["Lead Shot, 5 lb bag", { quantity: 5, unit: "lb" }],
      ["Ethernet Cable 6 ft (10 Pack)", { quantity: 10, unit: "" }],
      ["Zip Ties 8in, 100-pack", { quantity: 100, unit: "" }],
    ] as const) {
      expect(guessPack(name), name).toEqual(pack);
    }
    for (const name of [
      '1/2" Hex Shaft (36" L)',
      "3M VHB Tape",
      "Torque Wrench 20-150 ft-lb",
      "Mini CIM Motor, 2.5 lb",
      "M3 x 10mm Socket Head Screw",
      "Kraken X60 Motor",
    ]) {
      expect(guessPack(name), name).toBeNull();
    }
  });

  it("prices a part from a pack", () => {
    expect(pricePerPart(1750, 4)).toBe(438);
    expect(pricePerPart(1750, 1)).toBe(1750);
    expect(pricePerPart(null, 4)).toBeNull();
  });
});

describe("on requests and the catalog", () => {
  const packUrl = `https://www.revrobotics.com/${crypto.randomUUID()}/`;

  it("is 1 unless the request says", async () => {
    const { id: categoryId } = await jsonAs<{ id: number }>(
      mentor,
      "/categories",
      { method: "POST", body: { name: `Packs ${crypto.randomUUID()}` } },
      201,
    );
    await callAs(mentor, "/catalog/categories", { method: "POST", body: { name: "Wheels" } });
    const post = (b: Record<string, unknown>, status = 201) =>
      jsonAs<Request>(student, "/requests", { method: "POST", body: { ...b, categoryId } }, status);

    const single = await post(body(`https://www.revrobotics.com/${crypto.randomUUID()}/`));
    expect(single.packQuantity).toBe(1);

    // A pack of 4: the request has it, and so does the new catalog part.
    const url = packUrl;
    const pack = await post(body(url, { packQuantity: 4 }));
    expect(pack.packQuantity).toBe(4);
    expect((await catalogItem(pack.catalogItemId)).packQuantity).toBe(4);

    // The next request for that part is a pack of 4 without saying so.
    const again = await post(body(url));
    expect(again).toMatchObject({ catalogItemId: pack.catalogItemId, packQuantity: 4 });
    // Saying otherwise is for that request; the catalog keeps what it knows.
    const loose = await post(body(url, { packQuantity: 1 }));
    expect(loose.packQuantity).toBe(1);
    expect((await catalogItem(pack.catalogItemId)).packQuantity).toBe(4);

    // A part the catalog had as a single learns it's a pack from a request that says so.
    const relinked = await post({
      ...body(`https://www.revrobotics.com/${crypto.randomUUID()}/`),
      catalogItemId: single.catalogItemId,
      packQuantity: 6,
    });
    expect(relinked.catalogItemId).toBe(single.catalogItemId);
    expect((await catalogItem(single.catalogItemId)).packQuantity).toBe(6);

    for (const bad of [0, 1.5, -2, 10_001, "4"]) {
      const res = await callAs(student, "/requests", {
        method: "POST",
        body: { ...body(url, { packQuantity: bad }), categoryId },
      });
      expect(res.status, String(bad)).toBe(400);
    }

    // It can be fixed while the request is waiting, by the requester or a mentor.
    const fixed = await jsonAs<Request>(student, `/requests/${single.id}`, {
      method: "PATCH",
      body: { packQuantity: 2 },
    });
    expect(fixed.packQuantity).toBe(2);
    for (const bad of [0, 1.5, -2, 10_001, "4"]) {
      const res = await callAs(student, `/requests/${single.id}`, {
        method: "PATCH",
        body: { packQuantity: bad },
      });
      expect(res.status, String(bad)).toBe(400);
    }
    expect(
      (
        await callAs(otherStudent, `/requests/${single.id}`, {
          method: "PATCH",
          body: { packQuantity: 3 },
        })
      ).status,
    ).toBe(403);
  });

  it("can be an amount in a unit, which requests and the catalog keep too", async () => {
    const { id: categoryId } = await jsonAs<{ id: number }>(
      mentor,
      "/categories",
      { method: "POST", body: { name: `Spools ${crypto.randomUUID()}` } },
      201,
    );
    await callAs(mentor, "/catalog/categories", { method: "POST", body: { name: "Wheels" } });
    const post = (b: Record<string, unknown>, status = 201) =>
      jsonAs<Request>(student, "/requests", { method: "POST", body: { ...b, categoryId } }, status);
    const url = `https://www.revrobotics.com/${crypto.randomUUID()}/`;

    const spool = await post(body(url, { packQuantity: 100, packUnit: " ft " }));
    expect(spool).toMatchObject({ packQuantity: 100, packUnit: "ft" });
    expect(await catalogItem(spool.catalogItemId)).toMatchObject({
      packQuantity: 100,
      packUnit: "ft",
    });
    // The next one starts as 100 ft; "each" is saved as one of each.
    expect(await post(body(url))).toMatchObject({ packQuantity: 100, packUnit: "ft" });
    expect(await post(body(url, { packQuantity: 1, packUnit: "each" }))).toMatchObject({
      packQuantity: 1,
      packUnit: "",
    });
    const bad = await callAs(student, "/requests", {
      method: "POST",
      body: { ...body(url, { packUnit: "x".repeat(21) }), categoryId },
    });
    expect(bad.status).toBe(400);

    // Changing it while it waits is in the request's history once it's approved.
    const waiting = await post(body(url));
    await jsonAs(mentor, `/requests/${waiting.id}/approve`, { method: "POST" });
    await jsonAs(mentor, `/requests/${waiting.id}`, {
      method: "PATCH",
      body: { packQuantity: 1200, packUnit: "in" },
    });
    const { events } = await jsonAs<{ events: { action: string; note: string | null }[] }>(
      student,
      `/requests/${waiting.id}`,
    );
    expect(events.find((e) => e.action === "reapproved")?.note).toContain(
      "pack of 100 ft → 1200 in",
    );
  });

  it("is set on a catalog part by catalog editors", async () => {
    await callAs(mentor, "/catalog/categories", { method: "POST", body: { name: "Wheels" } });
    const made = await jsonAs<CatalogItem>(
      mentor,
      "/catalog/items",
      {
        method: "POST",
        body: {
          name: "Compliant wheel 4 pack",
          category: "Wheels",
          vendor: "REV",
          sku: null,
          url: `https://www.revrobotics.com/${crypto.randomUUID()}/`,
          options: {},
          packQuantity: 4,
        },
      },
      201,
    );
    expect(made).toMatchObject({ packQuantity: 4, packUnit: "" });
    const spool = await callAs(mentor, `/catalog/items/${made.id}`, {
      method: "PATCH",
      body: { packQuantity: 50, packUnit: "ft" },
    });
    expect(await spool.json()).toMatchObject({ packQuantity: 50, packUnit: "ft" });
    expect(
      (
        await callAs(mentor, `/catalog/items/${made.id}`, {
          method: "PATCH",
          body: { packUnit: "x".repeat(21) },
        })
      ).status,
    ).toBe(400);
    await callAs(mentor, `/catalog/items/${made.id}`, {
      method: "PATCH",
      body: { packQuantity: 4, packUnit: "" },
    });
    const edit = (user: typeof mentor, packQuantity: unknown) =>
      callAs(user, `/catalog/items/${made.id}`, { method: "PATCH", body: { packQuantity } });
    expect((await edit(student, 2)).status).toBe(403);
    expect((await edit(mentor, 0)).status).toBe(400);
    expect((await edit(mentor, 2)).status).toBe(200);
    expect((await catalogItem(made.id)).packQuantity).toBe(2);
  });

  it("is suggested for a new request: the catalog's, else a guess from the name", async () => {
    const suggest = (url: string, title: string) =>
      jsonAs<Suggestion>(student, "/suggest", {
        method: "POST",
        body: { url, vendor: "REV Robotics", sku: null, title, variant: null },
      });
    // The pack of 4 requested above: the catalog knows, whatever the name says.
    expect(await suggest(packUrl, '4" ION Flap Wheel (30A, 1/2" Hex Bore) PK10')).toMatchObject({
      packQuantity: 4,
      packQuantityGuess: null,
    });
    const fresh = `https://www.revrobotics.com/${crypto.randomUUID()}/`;
    expect(await suggest(fresh, '4" ION Flap Wheel (30A, 1/2" Hex Bore) PK4')).toMatchObject({
      packQuantity: null,
      packQuantityGuess: 4,
    });
    expect(await suggest(fresh, "Kraken X60 Motor")).toMatchObject({
      packQuantity: null,
      packQuantityGuess: null,
      packUnitGuess: null,
    });
    expect(await suggest(fresh, "Silicone Wire 22 AWG, Red, 25 ft")).toMatchObject({
      packQuantity: null,
      packUnit: null,
      packQuantityGuess: 25,
      packUnitGuess: "ft",
    });
  });
});
