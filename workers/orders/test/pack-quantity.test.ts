import { mentor, otherStudent, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { guessPackQuantity, pricePerPart } from "../src/lib/pack-quantity";

// Pack quantity: how many parts one unit of a product is. A request carries it, the catalog part
// remembers it, and a product's name can suggest it.

type Request = { id: number; packQuantity: number; catalogItemId: number };
type CatalogItem = { id: number; packQuantity: number };
type Suggestion = { packQuantity: number | null; packQuantityGuess: number | null };

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
    expect(
      (
        await callAs(otherStudent, `/requests/${single.id}`, {
          method: "PATCH",
          body: { packQuantity: 3 },
        })
      ).status,
    ).toBe(403);
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
    expect(made.packQuantity).toBe(4);
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
    });
  });
});
