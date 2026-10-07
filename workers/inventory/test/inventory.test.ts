import { admin, kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Inventory: anyone signed in (kiosk sessions too) reads the table, adds entries and moves parts;
// mentors and admins delete, merge and split; G3ID admins (never from a kiosk) arrange the team's
// fields, locations, robots and subsystems on Settings. None of that arrangement is in the app:
// a database starts empty.
//
// The tests share one database and run in order.

type Field = { id: number; name: string; type: string; options: string[]; showInTable: boolean };
type Location = { id: number; parentId: number | null; name: string; title: string };
type Named = { id: number; name: string };
type Stock = {
  id: number;
  locationId: number;
  status: "storage" | "in_use";
  robotId: number | null;
  subsystemId: number | null;
  quantity: number;
  countedAt: number | null;
  countedByName: string | null;
};
type Listing = {
  id: number;
  catalogItemId: number | null;
  vendor: string;
  sku: string | null;
  url: string | null;
  priceCents: number | null;
};
type Item = {
  id: number;
  name: string;
  values: Record<string, string | number | boolean>;
  stock: Stock[];
  listings: Listing[];
};
type Inventory = {
  fields: Field[];
  locations: Location[];
  robots: Named[];
  subsystems: Named[];
  items: Item[];
};
type Event = { action: string; note: string | null; ref: string | null; userName: string };
type Summary = {
  fields: number;
  choices: number;
  locations: number;
  robots: number;
  subsystems: number;
  already: number;
};

const post = (body: unknown) => ({ method: "POST", body });
const patch = (body: unknown) => ({ method: "PATCH", body });

const inventory = () => jsonAs<Inventory>(student, "/inventory");
const detail = (id: number) => jsonAs<{ item: Item; events: Event[] }>(student, `/items/${id}`);
const itemOf = async (id: number) => (await detail(id)).item;

/** The id of a location by its path of names. */
async function locationId(...path: string[]): Promise<number> {
  const { locations } = await inventory();
  let parentId: number | null = null;
  for (const name of path) {
    const found = locations.find((row) => row.parentId === parentId && row.name === name);
    if (!found) throw new Error(`No location ${path.join(" › ")}`);
    parentId = found.id;
  }
  return parentId as number;
}

const robotId = async (name: string) =>
  ((await inventory()).robots.find((row) => row.name === name) as Named).id;
const subsystemId = async (name: string) =>
  ((await inventory()).subsystems.find((row) => row.name === name) as Named).id;

const newItem = async (body: Record<string, unknown>) =>
  (await jsonAs<{ id: number }>(student, "/items", post(body), 201)).id;

const SETUP = {
  format: "gearbox-inventory-setup",
  version: 1,
  fields: [
    { name: "Type", type: "choice", options: ["Hardware", "Motors"] },
    { name: "Notes", type: "paragraph", showInTable: false },
  ],
  locations: [
    { name: "Shop", children: [{ name: "Shelves", children: ["Bin 1", "Bin 2"] }, "Cabinet"] },
    { name: "Pit", children: ["Pit cart"] },
  ],
  robots: ["Comp bot"],
  subsystems: ["Drivetrain", "Intake"],
};

describe("signing in", () => {
  it("answers nothing without a session", async () => {
    expect((await call("/inventory")).status).toBe(401);
    expect((await call("/items", { method: "POST" })).status).toBe(401);
  });

  it("says what each person can do", async () => {
    expect(await jsonAs(student, "/me")).toMatchObject({ isMentor: false, isAdmin: false });
    expect(await jsonAs(mentor, "/me")).toMatchObject({ isMentor: true, isAdmin: false });
    expect(await jsonAs(admin, "/me")).toMatchObject({ isMentor: true, isAdmin: true });
    // An admin's PIN session on a kiosk is just a member.
    expect(await jsonAs(kioskAdmin, "/me")).toMatchObject({ isMentor: false, isAdmin: false });
  });

  it("starts with nothing: the arrangement is the team's", async () => {
    expect(await inventory()).toEqual({
      fields: [],
      locations: [],
      robots: [],
      subsystems: [],
      items: [],
    });
  });
});

describe("settings", () => {
  it("is for admins, and not from a kiosk", async () => {
    for (const user of [student, mentor, kioskAdmin]) {
      expect((await callAs(user, "/locations", post({ name: "Nope" }))).status).toBe(403);
      expect((await callAs(user, "/fields", post({ name: "Nope", type: "text" }))).status).toBe(
        403,
      );
      expect((await callAs(user, "/robots", post({ name: "Nope" }))).status).toBe(403);
      expect((await callAs(user, "/setup/import", post(SETUP))).status).toBe(403);
      expect((await callAs(user, "/setup/export")).status).toBe(403);
    }
  });

  it("says what's wrong with a bad setup file", async () => {
    const res = await callAs(admin, "/setup/preview", post({ format: "something-else" }));
    expect(res.status).toBe(400);
    const deep = {
      ...SETUP,
      locations: [
        {
          name: "1",
          children: [
            { name: "2", children: [{ name: "3", children: [{ name: "4", children: ["5"] }] }] },
          ],
        },
      ],
      fields: [{ name: "Kind", type: "dropdown" }],
      robots: ["Twin", "twin"],
    };
    const { problems } = await jsonAs<{ problems: string[] }>(
      admin,
      "/setup/preview",
      post(deep),
      400,
    );
    expect(problems.join("\n")).toMatch(/4 levels deep/);
    expect(problems.join("\n")).toMatch(/"type" must be one of/);
    expect(problems.join("\n")).toMatch(/"twin" is listed twice/);
  });

  it("previews a setup file without loading it, then loads it", async () => {
    const wanted = { fields: 2, choices: 0, locations: 7, robots: 1, subsystems: 2, already: 0 };
    expect(await jsonAs<Summary>(admin, "/setup/preview", post(SETUP))).toEqual(wanted);
    expect((await inventory()).locations).toEqual([]);

    expect(await jsonAs<Summary>(admin, "/setup/import", post(SETUP))).toEqual(wanted);
    const loaded = await inventory();
    expect(loaded.fields.map((f) => f.name)).toEqual(["Type", "Notes"]);
    expect(loaded.fields[1].showInTable).toBe(false);
    expect(loaded.locations).toHaveLength(7);
    expect(await locationId("Shop", "Shelves", "Bin 2")).toBeGreaterThan(0);
    expect(loaded.robots.map((r) => r.name)).toEqual(["Comp bot"]);
    expect(loaded.subsystems.map((s) => s.name)).toEqual(["Drivetrain", "Intake"]);
  });

  it("loading again only adds what's missing", async () => {
    const more = {
      ...SETUP,
      fields: [{ name: "type", type: "choice", options: ["Motors", "Electronics"] }],
      locations: [
        { name: "shop", children: [{ name: "Shelves", children: ["Bin 3"] }] },
        "Trailer",
      ],
      robots: ["comp bot", "Practice bot"],
      subsystems: [],
    };
    expect(await jsonAs<Summary>(admin, "/setup/import", post(more))).toEqual({
      fields: 0,
      choices: 1,
      locations: 2,
      robots: 1,
      subsystems: 0,
      // The Type field, Shop, Shelves and Comp bot.
      already: 4,
    });
    const loaded = await inventory();
    expect(loaded.fields[0].options).toEqual(["Hardware", "Motors", "Electronics"]);
    expect(loaded.locations).toHaveLength(9);
    expect(await locationId("Shop", "Shelves", "Bin 3")).toBeGreaterThan(0);
  });

  it("saves the setup as a file that loads back", async () => {
    const file = await jsonAs<typeof SETUP>(admin, "/setup/export");
    expect(file.format).toBe("gearbox-inventory-setup");
    expect(file.locations.map((l) => l.name)).toEqual(["Shop", "Pit", "Trailer"]);
    expect(file.robots).toEqual(["Comp bot", "Practice bot"]);
    expect(await jsonAs<Summary>(admin, "/setup/preview", post(file))).toMatchObject({
      fields: 0,
      locations: 0,
      robots: 0,
      subsystems: 0,
    });
    // The starter that comes with the app is a valid file too.
    const starter = await jsonAs(admin, "/setup/starter");
    expect((await callAs(admin, "/setup/preview", post(starter))).status).toBe(200);
  });

  it("keeps locations to four levels, with names unique where they are", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 1");
    const added = await jsonAs<{ added: number; skipped: number }>(
      admin,
      "/locations",
      post({ parentId: bin, names: ["Left", "Right", "left"] }),
      201,
    );
    expect(added).toEqual({ added: 2, skipped: 0 });
    const left = await locationId("Shop", "Shelves", "Bin 1", "Left");
    // A fifth level.
    expect((await callAs(admin, "/locations", post({ parentId: left, name: "Tray" }))).status).toBe(
      400,
    );
    // Adding one that's there is skipped, not doubled.
    expect(
      await jsonAs(admin, "/locations", post({ parentId: bin, names: ["Right", "Middle"] }), 201),
    ).toEqual({ added: 1, skipped: 1 });

    const right = await locationId("Shop", "Shelves", "Bin 1", "Right");
    expect((await callAs(admin, `/locations/${right}`, patch({ name: "LEFT" }))).status).toBe(409);
    // Shop can't go inside its own shelf, and Shelves (three levels tall) can't go under Pit cart.
    const shop = await locationId("Shop");
    const shelves = await locationId("Shop", "Shelves");
    const cart = await locationId("Pit", "Pit cart");
    expect((await callAs(admin, `/locations/${shop}`, patch({ parentId: shelves }))).status).toBe(
      400,
    );
    expect((await callAs(admin, `/locations/${shelves}`, patch({ parentId: cart }))).status).toBe(
      400,
    );
    // Moving a bin (two levels tall) to the top level is fine, and back.
    await jsonAs(admin, `/locations/${bin}`, patch({ parentId: null, name: "Loose bin" }));
    expect(await locationId("Loose bin", "Left")).toBe(left);
    await jsonAs(admin, `/locations/${bin}`, patch({ parentId: shelves, name: "Bin 1" }));
  });

  it("puts the locations inside one place in order, leaving the other places alone", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 1");
    const inside = async (parentId: number | null) =>
      (await inventory()).locations
        .filter((row) => row.parentId === parentId)
        .map((row) => row.name);
    const idsOf = (names: string[]) =>
      Promise.all(names.map((name) => locationId("Shop", "Shelves", "Bin 1", name)));
    const order = (ids: number[]) => ({ method: "PUT", body: { ids } });
    expect(await inside(bin)).toEqual(["Left", "Right", "Middle"]);
    const top = await inside(null);
    const shelves = await inside(await locationId("Shop", "Shelves"));

    const ids = await idsOf(["Middle", "Left", "Right"]);
    // The tree is the admins' to arrange.
    expect((await callAs(mentor, "/locations/order", order(ids))).status).toBe(403);
    expect((await callAs(admin, "/locations/order", order([]))).status).toBe(400);
    await jsonAs(admin, "/locations/order", order(ids));
    expect(await inside(bin)).toEqual(["Middle", "Left", "Right"]);
    expect(await inside(null)).toEqual(top);
    expect(await inside(await locationId("Shop", "Shelves"))).toEqual(shelves);

    // A location added afterwards goes at the end.
    await jsonAs(admin, "/locations", post({ parentId: bin, names: ["Spare"] }), 201);
    expect(await inside(bin)).toEqual(["Middle", "Left", "Right", "Spare"]);
    const spare = await locationId("Shop", "Shelves", "Bin 1", "Spare");
    await jsonAs(admin, `/locations/${spare}`, { method: "DELETE" });
    await jsonAs(admin, "/locations/order", order(await idsOf(["Left", "Right", "Middle"])));
    expect(await inside(bin)).toEqual(["Left", "Right", "Middle"]);
  });

  it("defines the fields entries are described by", async () => {
    const made = await jsonAs<{ id: number }>(
      admin,
      "/fields",
      post({ name: "Thread", type: "text" }),
      201,
    );
    expect((await callAs(admin, "/fields", post({ name: "thread", type: "text" }))).status).toBe(
      409,
    );
    expect((await callAs(admin, "/fields", post({ name: "Kind", type: "choice" }))).status).toBe(
      400,
    );
    await jsonAs(admin, `/fields/${made.id}`, patch({ name: "Thread size", showInTable: false }));
    const { fields } = await inventory();
    expect(fields.map((f) => f.name)).toEqual(["Type", "Notes", "Thread size"]);
    await jsonAs(admin, "/fields/order", {
      method: "PUT",
      body: { ids: [made.id, fields[0].id, fields[1].id] },
    });
    expect((await inventory()).fields.map((f) => f.name)).toEqual(["Thread size", "Type", "Notes"]);
  });
});

describe("entries", () => {
  let bolts = 0;

  it("anyone signed in adds one, with where it's kept", async () => {
    const { fields } = await inventory();
    const type = fields.find((f) => f.name === "Type") as Field;
    const bin = await locationId("Shop", "Shelves", "Bin 2");

    // A choice that isn't one of the field's.
    const bad = await callAs(
      student,
      "/items",
      post({ name: "Bolts", values: { [type.id]: "Snacks" } }),
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/Type must be one of/);

    bolts = await newItem({
      name: '10-32 x 1/2" bolts',
      values: { [type.id]: "Hardware" },
      stock: { quantity: 40, locationId: bin },
    });
    const item = await itemOf(bolts);
    expect(item.values).toEqual({ [type.id]: "Hardware" });
    expect(item.stock).toMatchObject([{ locationId: bin, status: "storage", quantity: 40 }]);
    expect((await detail(bolts)).events).toMatchObject([
      { action: "created", note: "40 in Shop › Shelves › Bin 2.", userName: "Sam Student" },
    ]);
    expect((await inventory()).items.map((i) => i.id)).toContain(bolts);
  });

  it("edits are checked against the fields and go in the history", async () => {
    const { fields } = await inventory();
    const thread = fields.find((f) => f.name === "Thread size") as Field;
    await jsonAs(otherStudent, `/items/${bolts}`, patch({ values: { [thread.id]: " 10-32 " } }));
    expect((await itemOf(bolts)).values[thread.id]).toBe("10-32");
    await jsonAs(otherStudent, `/items/${bolts}`, patch({ name: "10-32 bolts" }));
    // Saving the same thing again isn't an edit.
    await jsonAs(otherStudent, `/items/${bolts}`, patch({ name: "10-32 bolts" }));
    const { events } = await detail(bolts);
    expect(events.slice(0, 2)).toMatchObject([
      { action: "edited", note: 'Renamed from "10-32 x 1/2" bolts".', userName: "Olive Other" },
      { action: "edited", note: "Changed Thread size." },
    ]);
    expect(events).toHaveLength(3);
    // An unknown field.
    expect(
      (await callAs(student, `/items/${bolts}`, patch({ values: { 9999: "x" } }))).status,
    ).toBe(400);
  });

  it("a count sets the quantity and says who counted", async () => {
    const [row] = (await itemOf(bolts)).stock;
    await jsonAs(student, `/stock/${row.id}`, patch({ quantity: 36 }));
    const [counted] = (await itemOf(bolts)).stock;
    expect(counted).toMatchObject({ quantity: 36, countedByName: "Sam Student" });
    expect(counted.countedAt).toBeGreaterThan(0);
    expect((await detail(bolts)).events[0]).toMatchObject({
      action: "counted",
      note: "40 → 36 in Shop › Shelves › Bin 2.",
    });
    expect((await callAs(student, `/stock/${row.id}`, patch({ quantity: -1 }))).status).toBe(400);
    expect((await callAs(student, `/stock/${row.id}`, patch({ quantity: 1.5 }))).status).toBe(400);
  });

  it("moving a row moves all of it, onto what's already there", async () => {
    const [row] = (await itemOf(bolts)).stock;
    const cabinet = await locationId("Shop", "Cabinet");
    await jsonAs(student, `/stock/${row.id}`, patch({ locationId: cabinet }));
    expect((await itemOf(bolts)).stock).toMatchObject([{ locationId: cabinet, quantity: 36 }]);
    expect((await detail(bolts)).events[0]).toMatchObject({
      action: "moved",
      note: "36 from Shop › Shelves › Bin 2 to Shop › Cabinet.",
    });
    // More of them turn up in a bin, then get moved to join the rest.
    const bin = await locationId("Shop", "Shelves", "Bin 2");
    await jsonAs(student, `/items/${bolts}/stock`, post({ quantity: 4, locationId: bin }));
    const found = (await itemOf(bolts)).stock.find((s) => s.locationId === bin) as Stock;
    await jsonAs(student, `/stock/${found.id}`, patch({ locationId: cabinet }));
    expect((await itemOf(bolts)).stock).toMatchObject([{ locationId: cabinet, quantity: 40 }]);
    // Nowhere.
    expect((await callAs(student, `/stock/${row.id}`, patch({ locationId: 999999 }))).status).toBe(
      404,
    );
  });

  it("checking out puts some in use on a robot's subsystem", async () => {
    const [storage] = (await itemOf(bolts)).stock;
    const cart = await locationId("Pit", "Pit cart");
    const robot = await robotId("Comp bot");
    const drivetrain = await subsystemId("Drivetrain");
    const out = (quantity: number, extra: Record<string, unknown> = {}) =>
      callAs(
        student,
        `/stock/${storage.id}/check-out`,
        post({ quantity, locationId: cart, robotId: robot, subsystemId: drivetrain, ...extra }),
      );

    // In use needs a robot and a subsystem that exist.
    expect((await out(4, { robotId: null })).status).toBe(400);
    expect((await out(4, { subsystemId: 999999 })).status).toBe(400);
    // More than there are.
    const tooMany = await out(41);
    expect(tooMany.status).toBe(409);
    expect((await itemOf(bolts)).stock).toHaveLength(1);

    expect((await out(4)).status).toBe(200);
    expect((await out(6)).status).toBe(200);
    const stock = (await itemOf(bolts)).stock;
    expect(stock).toMatchObject([
      { status: "storage", quantity: 30 },
      { status: "in_use", locationId: cart, robotId: robot, subsystemId: drivetrain, quantity: 10 },
    ]);
    expect((await detail(bolts)).events[0]).toMatchObject({
      action: "checked_out",
      note: "6 from Shop › Cabinet to Pit › Pit cart, on Comp bot (Drivetrain).",
    });
    // Parts in use can't be checked out again, and a robot with parts on it can't be removed.
    const inUse = stock[1];
    expect(
      (
        await callAs(
          student,
          `/stock/${inUse.id}/check-out`,
          post({ quantity: 1, locationId: cart, robotId: robot, subsystemId: drivetrain }),
        )
      ).status,
    ).toBe(409);
    expect((await callAs(admin, `/robots/${robot}`, { method: "DELETE" })).status).toBe(409);
  });

  it("checking in brings them back to storage", async () => {
    const stock = (await itemOf(bolts)).stock;
    const inUse = stock.find((s) => s.status === "in_use") as Stock;
    const cabinet = await locationId("Shop", "Cabinet");
    const bin = await locationId("Shop", "Shelves", "Bin 2");
    const back = (quantity: number, to: number) =>
      callAs(student, `/stock/${inUse.id}/check-in`, post({ quantity, locationId: to }));

    expect((await back(11, cabinet)).status).toBe(409);
    expect((await back(3, cabinet)).status).toBe(200);
    // Back where they were kept, the place is only said once.
    expect((await detail(bolts)).events[0]).toMatchObject({
      action: "checked_in",
      note: "3 from Pit › Pit cart, on Comp bot (Drivetrain) to Shop › Cabinet.",
    });
    // Somewhere new in storage is fine too.
    expect((await back(2, bin)).status).toBe(200);
    expect((await itemOf(bolts)).stock).toMatchObject([
      { status: "storage", locationId: cabinet, quantity: 33 },
      { status: "storage", locationId: bin, quantity: 2 },
      { status: "in_use", quantity: 5 },
    ]);
    // The last of them: the in-use row is gone, not left at zero.
    expect((await back(5, cabinet)).status).toBe(200);
    const after = (await itemOf(bolts)).stock;
    expect(after.every((s) => s.status === "storage")).toBe(true);
    expect(after.reduce((sum, s) => sum + s.quantity, 0)).toBe(40);
    expect((await back(1, cabinet)).status).toBe(404);

    // A storage row that's emptied goes too, when the entry is kept somewhere else as well.
    const binRow = after.find((s) => s.locationId === bin) as Stock;
    await jsonAs(
      student,
      `/stock/${binRow.id}/check-out`,
      post({
        quantity: 2,
        locationId: bin,
        robotId: await robotId("Comp bot"),
        subsystemId: await subsystemId("Drivetrain"),
      }),
    );
    const out = (await itemOf(bolts)).stock;
    expect(out).toMatchObject([
      { status: "storage", locationId: cabinet, quantity: 38 },
      { status: "in_use", locationId: bin, quantity: 2 },
    ]);
    // Checked in with the rest, they join that row.
    await jsonAs(
      student,
      `/stock/${out[1].id}/check-in`,
      post({ quantity: 2, locationId: cabinet }),
    );
    expect((await itemOf(bolts)).stock).toMatchObject([
      { status: "storage", locationId: cabinet, quantity: 40 },
    ]);
  });

  it("an entry with everything on a robot still remembers where it lives", async () => {
    const shelf = await locationId("Shop", "Shelves", "Bin 3");
    const cart = await locationId("Pit", "Pit cart");
    const motor = await newItem({ name: "Kraken X60", stock: { quantity: 2, locationId: shelf } });
    const [home] = (await itemOf(motor)).stock;
    await jsonAs(
      student,
      `/stock/${home.id}/check-out`,
      post({
        quantity: 2,
        locationId: cart,
        robotId: await robotId("Comp bot"),
        subsystemId: await subsystemId("Intake"),
      }),
    );
    expect((await itemOf(motor)).stock).toMatchObject([
      { status: "storage", locationId: shelf, quantity: 0 },
      { status: "in_use", quantity: 2 },
    ]);
    // Put in use without leaving its shelf, the place is only said once.
    const spare = await newItem({ name: "Spare motor", stock: { quantity: 3, locationId: shelf } });
    const [spareRow] = (await itemOf(spare)).stock;
    const use = { robotId: await robotId("Comp bot"), subsystemId: await subsystemId("Intake") };
    await jsonAs(
      student,
      `/stock/${spareRow.id}/check-out`,
      post({ quantity: 1, locationId: shelf, ...use }),
    );
    const spareUse = (await itemOf(spare)).stock[1];
    await jsonAs(
      student,
      `/stock/${spareUse.id}/check-in`,
      post({ quantity: 1, locationId: shelf }),
    );
    expect((await detail(spare)).events.slice(0, 2)).toMatchObject([
      { action: "checked_in", note: "1 in Shop › Shelves › Bin 3, off Comp bot (Intake)." },
      { action: "checked_out", note: "1 in Shop › Shelves › Bin 3, onto Comp bot (Intake)." },
    ]);
    await jsonAs(mentor, `/items/${spare}`, { method: "DELETE" });
    // Checked in somewhere else: that's its home now, and the empty row goes.
    const cabinet = await locationId("Shop", "Cabinet");
    const inUse = (await itemOf(motor)).stock[1];
    await jsonAs(
      student,
      `/stock/${inUse.id}/check-in`,
      post({ quantity: 2, locationId: cabinet }),
    );
    expect((await itemOf(motor)).stock).toMatchObject([
      { status: "storage", locationId: cabinet, quantity: 2 },
    ]);
    // A location with parts in it can't be removed; an empty one can, with what's inside it.
    expect(
      (await callAs(admin, `/locations/${await locationId("Shop")}`, { method: "DELETE" })).status,
    ).toBe(409);
    const trailer = await locationId("Trailer");
    await jsonAs(admin, "/locations", post({ parentId: trailer, names: ["Crate"] }), 201);
    await jsonAs(admin, `/locations/${trailer}`, { method: "DELETE" });
    expect((await inventory()).locations.some((l) => l.name === "Crate")).toBe(false);
  });

  it("a kiosk session can do what any member can", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 1");
    const id = (
      await jsonAs<{ id: number }>(
        kioskAdmin,
        "/items",
        post({ name: "Zip ties", stock: { quantity: 100, locationId: bin } }),
        201,
      )
    ).id;
    const [row] = (await itemOf(id)).stock;
    await jsonAs(kioskAdmin, `/stock/${row.id}`, patch({ quantity: 90 }));
    // But not what a mentor can.
    expect((await callAs(kioskAdmin, `/items/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await callAs(student, `/items/${id}`, { method: "DELETE" })).status).toBe(403);
    await jsonAs(mentor, `/items/${id}`, { method: "DELETE" });
    expect((await callAs(student, `/items/${id}`)).status).toBe(404);
  });
});

describe("listings, merging and splitting", () => {
  let wcp = 0;
  let rev = 0;

  it("an entry lists the ways to buy it, one catalog part to one entry", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 1");
    wcp = await newItem({
      name: "1/2 hex bearing",
      stock: { quantity: 10, locationId: bin },
      listing: {
        catalogItemId: 501,
        vendor: "WCP",
        sku: "WCP-0027",
        name: "1/2 Hex Bearing",
        url: "https://wcproducts.com/products/bearings?variant=1",
        priceCents: 399,
        priceAt: 1_700_000_000_000,
      },
    });
    expect((await itemOf(wcp)).listings).toMatchObject([
      { catalogItemId: 501, vendor: "WCP", sku: "WCP-0027", priceCents: 399 },
    ]);
    // The same catalog part again, here or on another entry.
    const again = { catalogItemId: 501, vendor: "WCP" };
    expect((await callAs(student, `/items/${wcp}/listings`, post(again))).status).toBe(409);
    const taken = await callAs(student, "/items", post({ name: "Bearing", listing: again }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ itemId: wcp });
    // A listing needs a vendor or a link, and the link has to be one.
    expect((await callAs(student, `/items/${wcp}/listings`, post({ sku: "X" }))).status).toBe(400);
    expect(
      (await callAs(student, `/items/${wcp}/listings`, post({ vendor: "X", url: "javascript:1" })))
        .status,
    ).toBe(400);

    rev = await newItem({
      name: "REV 1/2 hex bearing",
      stock: { quantity: 4, locationId: bin },
      listing: {
        vendor: "REV",
        sku: "REV-21-1016",
        url: "https://www.revrobotics.com/rev-21-1016/",
      },
    });
    await jsonAs(
      student,
      `/items/${rev}/stock`,
      post({ quantity: 6, locationId: await locationId("Shop", "Cabinet") }),
    );
  });

  it("only mentors merge; the parts, listings and history come along", async () => {
    expect((await callAs(student, `/items/${wcp}/merge`, post({ fromId: rev }))).status).toBe(403);
    expect((await callAs(mentor, `/items/${wcp}/merge`, post({ fromId: wcp }))).status).toBe(400);
    await jsonAs(mentor, `/items/${wcp}/merge`, post({ fromId: rev }));

    const bin = await locationId("Shop", "Shelves", "Bin 1");
    const cabinet = await locationId("Shop", "Cabinet");
    const item = await itemOf(wcp);
    // Same bin: the quantities add up. The other place comes over as it was.
    expect(item.stock).toMatchObject([
      { locationId: bin, quantity: 14 },
      { locationId: cabinet, quantity: 6 },
    ]);
    expect(item.listings.map((l) => l.vendor)).toEqual(["WCP", "REV"]);
    expect((await callAs(student, `/items/${rev}`)).status).toBe(404);
    const { events } = await detail(wcp);
    expect(events[0]).toMatchObject({
      action: "merged",
      note: '"REV 1/2 hex bearing" merged in: 10 parts, 1 listing.',
      userName: "Morgan Mentor",
    });
    // Both entries' "created" lines are here now.
    expect(events.filter((e) => e.action === "created")).toHaveLength(2);
  });

  it("splitting a listing off makes it its own entry, with the parts that are its", async () => {
    const item = await itemOf(wcp);
    const revListing = item.listings.find((l) => l.vendor === "REV") as Listing;
    const [binRow, cabinetRow] = item.stock;
    const split = (body: Record<string, unknown>, as = mentor) =>
      callAs(as, `/items/${wcp}/split`, post({ listingId: revListing.id, ...body }));

    expect((await split({}, student)).status).toBe(403);
    // More than the row holds: nothing changes, and no new entry is left behind.
    const before = (await inventory()).items.length;
    expect((await split({ stock: [{ stockId: cabinetRow.id, quantity: 7 }] })).status).toBe(409);
    expect((await inventory()).items).toHaveLength(before);
    expect((await itemOf(wcp)).listings).toHaveLength(2);

    const res = await split({
      name: "REV bearing",
      stock: [
        { stockId: binRow.id, quantity: 4 },
        { stockId: cabinetRow.id, quantity: 6 },
      ],
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    const made = await detail(id);
    expect(made.item.name).toBe("REV bearing");
    expect(made.item.listings.map((l) => l.sku)).toEqual(["REV-21-1016"]);
    expect(made.item.stock.map((s) => s.quantity).sort()).toEqual([4, 6]);
    expect(made.events[0]).toMatchObject({ action: "split", ref: `item:${wcp}` });

    const left = await detail(wcp);
    expect(left.item.listings.map((l) => l.vendor)).toEqual(["WCP"]);
    // The emptied storage row goes: the entry is still kept in the other place, with its ten.
    expect(left.item.stock.map((s) => s.quantity)).toEqual([10]);
    expect(left.events[0]).toMatchObject({
      action: "split",
      note: '"REV bearing" split off as its own entry, with 10.',
      ref: `item:${id}`,
    });
    // One listing left: nothing more to split off.
    const [last] = left.item.listings;
    expect((await callAs(mentor, `/items/${wcp}/split`, post({ listingId: last.id }))).status).toBe(
      400,
    );
  });

  it("a listing can be taken off again", async () => {
    await jsonAs(student, `/items/${wcp}/listings`, post({ vendor: "AndyMark", sku: "am-1" }), 201);
    const added = (await itemOf(wcp)).listings.find((l) => l.vendor === "AndyMark") as Listing;
    await jsonAs(student, `/items/${wcp}/listings/${added.id}`, { method: "DELETE" });
    expect((await itemOf(wcp)).listings.map((l) => l.vendor)).toEqual(["WCP"]);
    expect((await detail(wcp)).events.slice(0, 2)).toMatchObject([
      { action: "unlinked", note: "AndyMark am-1." },
      { action: "linked", note: "AndyMark am-1." },
    ]);
  });
});

describe("parts arriving from Orders", () => {
  type Result = {
    added: { sourceKey: string; itemId: number; created: boolean; duplicate: boolean }[];
  };
  const line = (sourceKey: string, quantity: number, listing: Record<string, unknown>) => ({
    sourceKey,
    quantity,
    name: "Falcon pinion 14t",
    listing: { vendor: "WCP", sku: "WCP-0500", priceCents: 1299, ...listing },
    note: "WCP order",
  });

  it("makes a new entry for a part it hasn't seen, and adds to it next time", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 2");
    const first = await jsonAs<Result>(
      student,
      "/intake",
      post({
        destination: { status: "storage", locationId: bin },
        lines: [line("orders:request:71", 3, { catalogItemId: 900 })],
      }),
    );
    expect(first.added).toMatchObject([{ created: true, duplicate: false }]);
    const id = first.added[0].itemId;
    const made = await detail(id);
    expect(made.item).toMatchObject({
      name: "Falcon pinion 14t",
      stock: [{ locationId: bin, status: "storage", quantity: 3 }],
      listings: [{ catalogItemId: 900, vendor: "WCP", sku: "WCP-0500", priceCents: 1299 }],
    });
    expect(made.events[0]).toMatchObject({
      action: "received",
      note: "3 into Shop › Shelves › Bin 2 (WCP order).",
      ref: "orders:request:71",
      userName: "Sam Student",
    });

    // The same catalog part again, straight onto the robot, at a new price.
    const cart = await locationId("Pit", "Pit cart");
    const second = await jsonAs<Result>(
      mentor,
      "/intake",
      post({
        destination: {
          status: "in_use",
          locationId: cart,
          robotId: await robotId("Comp bot"),
          subsystemId: await subsystemId("Drivetrain"),
        },
        lines: [line("orders:request:72", 2, { catalogItemId: 900, priceCents: 1399 })],
      }),
    );
    expect(second.added).toMatchObject([{ itemId: id, created: false, duplicate: false }]);
    const item = await itemOf(id);
    expect(item.stock).toMatchObject([
      { status: "storage", quantity: 3 },
      { status: "in_use", quantity: 2 },
    ]);
    expect(item.listings).toMatchObject([{ priceCents: 1399 }]);
  });

  it("adds a delivery once, however often it's sent", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 2");
    const again = await jsonAs<Result>(
      student,
      "/intake",
      post({
        destination: { status: "storage", locationId: bin },
        lines: [line("orders:request:71", 3, { catalogItemId: 900 })],
      }),
    );
    expect(again.added).toMatchObject([{ created: false, duplicate: true }]);
    const item = await itemOf(again.added[0].itemId);
    expect(item.stock[0].quantity).toBe(3);
  });

  it("finds the entry by vendor and part number, or by link, and puts two of a new part on one entry", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 2");
    const destination = { status: "storage", locationId: bin };
    // No catalog id this time: the vendor and part number are enough.
    const bySku = await jsonAs<Result>(
      student,
      "/intake",
      post({
        destination,
        lines: [line("orders:request:73", 1, { vendor: "wcp", sku: "wcp-0500" })],
      }),
    );
    expect(bySku.added[0].created).toBe(false);

    const url = "https://example.com/widgets/1";
    const both = await jsonAs<Result>(
      student,
      "/intake",
      post({
        destination,
        lines: [
          { ...line("orders:request:74", 5, { vendor: "", sku: null, url }), name: "Widget" },
          { ...line("orders:request:75", 2, { vendor: "", sku: null, url }), name: "Widget" },
        ],
      }),
    );
    expect(both.added[0].created).toBe(true);
    expect(both.added[1]).toMatchObject({ itemId: both.added[0].itemId, created: false });
    expect((await itemOf(both.added[0].itemId)).stock).toMatchObject([{ quantity: 7 }]);
  });

  it("refuses a place that doesn't exist, or parts in use without a robot", async () => {
    const lines = [line("orders:request:80", 1, {})];
    const cart = await locationId("Pit", "Pit cart");
    for (const destination of [
      { status: "storage", locationId: 999999 },
      { status: "in_use", locationId: cart },
      { status: "lost", locationId: cart },
    ]) {
      expect((await callAs(student, "/intake", post({ destination, lines }))).status).toBe(400);
    }
    expect((await call("/intake", { method: "POST" })).status).toBe(401);
    // Nothing was added by any of those.
    const again = await jsonAs<Result>(
      student,
      "/intake",
      post({ destination: { status: "storage", locationId: cart }, lines }),
    );
    expect(again.added[0].duplicate).toBe(false);
  });

  it("lists where things can go", async () => {
    const options = await jsonAs<{ locations: Location[]; robots: Named[]; subsystems: Named[] }>(
      kioskAdmin,
      "/options",
    );
    expect(options.locations.length).toBeGreaterThan(5);
    expect(options.robots.map((r) => r.name)).toContain("Comp bot");
    expect(options.subsystems.map((s) => s.name)).toEqual(["Drivetrain", "Intake"]);
  });
});

describe("the Locations page", () => {
  type Places = {
    places: {
      sourceKey: string;
      itemId: number | null;
      itemName: string | null;
      locationId: number | null;
    }[];
  };
  const setTitle = (user: typeof student, id: number, title: unknown) =>
    callAs(user, `/locations/${id}/title`, { method: "PUT", body: { title } });
  const moveAll = (user: typeof student, from: number, toLocationId: unknown) =>
    callAs(user, `/locations/${from}/move-contents`, post({ toLocationId }));

  it("lets anyone signed in give a location a title, shown beside its name everywhere", async () => {
    const cabinet = await locationId("Shop", "Cabinet");
    expect((await call(`/locations/${cabinet}/title`, { method: "PUT" })).status).toBe(401);
    expect((await setTitle(student, cabinet, "x".repeat(61))).status).toBe(400);
    expect((await setTitle(student, 999999, "Nowhere")).status).toBe(404);
    expect((await setTitle(kioskAdmin, cabinet, "  Fasteners ")).status).toBe(200);

    const { locations } = await inventory();
    expect(locations.find((l) => l.id === cabinet)).toMatchObject({
      name: "Cabinet",
      title: "Fasteners",
    });
    const options = await jsonAs<{ locations: Location[] }>(student, "/options");
    expect(options.locations.find((l) => l.id === cabinet)?.title).toBe("Fasteners");

    // History lines say it the way people read it.
    const id = await newItem({
      name: "Titled washers",
      stock: { quantity: 5, locationId: cabinet },
    });
    expect((await detail(id)).events[0].note).toBe("5 in Shop › Cabinet - Fasteners.");
    // A setup file carries it, and taking it off is an empty title.
    const file = await jsonAs<{
      locations: { name: string; children: { name: string; title?: string }[] }[];
    }>(admin, "/setup/export");
    const shop = file.locations.find((l) => l.name === "Shop");
    expect(shop?.children.find((l) => l.name === "Cabinet")?.title).toBe("Fasteners");
    expect(shop?.children.find((l) => l.name === "Shelves")?.title).toBeUndefined();
    await jsonAs(
      admin,
      "/setup/import",
      post({
        ...SETUP,
        fields: [],
        robots: [],
        subsystems: [],
        locations: [{ name: "Annex", title: "Overflow", children: [] }],
      }),
    );
    expect((await inventory()).locations.find((l) => l.name === "Annex")?.title).toBe("Overflow");
    expect((await setTitle(student, cabinet, "")).status).toBe(200);
    expect((await inventory()).locations.find((l) => l.id === cabinet)?.title).toBe("");
    await jsonAs(mentor, `/items/${id}`, { method: "DELETE" });
  });

  it("moves everything in a location at once, whole", async () => {
    const annex = await locationId("Annex");
    const bin = await locationId("Shop", "Shelves", "Bin 3");
    const cart = await locationId("Pit", "Pit cart");
    const use = { robotId: await robotId("Comp bot"), subsystemId: await subsystemId("Intake") };

    // In the annex: nuts, belts (some in use there), and a few more of the belts already in the bin.
    const nuts = await newItem({ name: "Lock nuts", stock: { quantity: 30, locationId: annex } });
    const belts = await newItem({ name: "Belts", stock: { quantity: 6, locationId: annex } });
    await jsonAs(student, `/items/${belts}/stock`, post({ quantity: 4, locationId: bin }));
    const [annexBelts] = (await itemOf(belts)).stock;
    await jsonAs(
      student,
      `/stock/${annexBelts.id}/check-out`,
      post({ quantity: 2, locationId: annex, ...use }),
    );
    // Elsewhere, and staying there.
    const elsewhere = await newItem({
      name: "Stays put",
      stock: { quantity: 9, locationId: cart },
    });

    expect((await call(`/locations/${annex}/move-contents`, { method: "POST" })).status).toBe(401);
    expect((await moveAll(student, annex, annex)).status).toBe(400);
    expect((await moveAll(student, annex, 999999)).status).toBe(400);
    expect((await moveAll(student, 999999, bin)).status).toBe(404);

    const res = await moveAll(otherStudent, annex, bin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: 2, parts: 36 });

    expect((await itemOf(nuts)).stock).toMatchObject([
      { locationId: bin, status: "storage", quantity: 30 },
    ]);
    // The belts in storage joined the ones already in the bin; the ones in use moved as they were.
    expect((await itemOf(belts)).stock).toMatchObject([
      { locationId: bin, status: "storage", quantity: 8 },
      { locationId: bin, status: "in_use", quantity: 2, ...use },
    ]);
    expect((await itemOf(elsewhere)).stock).toMatchObject([{ locationId: cart, quantity: 9 }]);
    expect((await detail(nuts)).events[0]).toMatchObject({
      action: "moved",
      note: "30 from Annex - Overflow to Shop › Shelves › Bin 3.",
      userName: "Olive Other",
    });
    expect((await detail(belts)).events.filter((e) => e.action === "moved")).toHaveLength(2);

    // The tree is as it was, and there's nothing left to move.
    expect((await inventory()).locations.some((l) => l.id === annex)).toBe(true);
    expect(await (await moveAll(student, annex, bin)).json()).toEqual({ entries: 0, parts: 0 });
    for (const id of [nuts, belts, elsewhere]) {
      await jsonAs(mentor, `/items/${id}`, { method: "DELETE" });
    }
  });

  it("takes deliveries for different places in one go, or none of them", async () => {
    type Result = { added: { sourceKey: string; itemId: number; created: boolean }[] };
    const bin = await locationId("Shop", "Shelves", "Bin 1");
    const cabinet = await locationId("Shop", "Cabinet");
    const line = (key: string, sku: string, where: unknown) => ({
      sourceKey: key,
      quantity: 2,
      name: `Part ${sku}`,
      listing: { vendor: "AndyMark", sku },
      note: null,
      locationId: where,
    });
    // One of them names a place that isn't there: nothing is added.
    const bad = await callAs(
      student,
      "/intake",
      post({
        destination: { status: "storage" },
        lines: [
          line("orders:request:201", "am-201", bin),
          line("orders:request:202", "am-202", 999999),
        ],
      }),
    );
    expect(bad.status).toBe(400);
    expect((await inventory()).items.some((i) => i.name === "Part am-201")).toBe(false);
    // With no place of its own and none given for all, a delivery has nowhere to go.
    expect(
      (
        await callAs(
          student,
          "/intake",
          post({
            destination: { status: "storage" },
            lines: [line("orders:request:203", "am-203", null)],
          }),
        )
      ).status,
    ).toBe(400);

    const ok = await jsonAs<Result>(
      student,
      "/intake",
      post({
        destination: { status: "storage", locationId: cabinet },
        lines: [
          line("orders:request:201", "am-201", bin),
          line("orders:request:202", "am-202", null),
        ],
      }),
    );
    expect((await itemOf(ok.added[0].itemId)).stock).toMatchObject([
      { locationId: bin, quantity: 2 },
    ]);
    expect((await itemOf(ok.added[1].itemId)).stock).toMatchObject([
      { locationId: cabinet, quantity: 2 },
    ]);
  });

  it("says where a part that's about to arrive is already kept", async () => {
    const bin = await locationId("Shop", "Shelves", "Bin 1");
    const answer = await jsonAs<Places>(
      kioskAdmin,
      "/intake/places",
      post({
        lines: [
          { sourceKey: "a", listing: { vendor: "andymark", sku: "AM-201" } },
          { sourceKey: "b", listing: { vendor: "AndyMark", sku: "never-seen" } },
        ],
      }),
    );
    expect(answer.places).toMatchObject([
      { sourceKey: "a", itemName: "Part am-201", locationId: bin },
      { sourceKey: "b", itemId: null, itemName: null, locationId: null },
    ]);
    expect((await call("/intake/places", { method: "POST" })).status).toBe(401);
    expect((await callAs(student, "/intake/places", post({ lines: [] }))).status).toBe(400);
  });
});
