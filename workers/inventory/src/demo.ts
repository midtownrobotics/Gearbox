import { inTeam, withTeam } from "@g3/auth";
import { DEMO_PEOPLE, type DemoPerson, SAFE_TEXT, vocabularyOf } from "@g3/demo";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./db";
import {
  fields,
  itemEvents,
  itemListings,
  items,
  locations,
  robots,
  stock,
  subsystems,
} from "./db/schema";
import { loadLocations } from "./lib/locations";
import { loadSetup, starterSetup } from "./lib/setup";
import { formatQuantity } from "./lib/units";

// The public demo's Inventory (roadmap 5.3), loaded after its nightly reset: the starter setup
// (fields, locations, robots, subsystems), a description on a few locations, and a shop's worth of
// entries, some on a robot.

/** Descriptions of what's kept in some of the starter locations, by name. */
const TITLES: Record<string, string> = {
  Shelves: SAFE_TEXT.contents[0],
  Cabinets: SAFE_TEXT.contents[1],
  Workbench: SAFE_TEXT.contents[5],
};

type Entry = {
  name: string;
  type: string;
  size?: string;
  /** What its quantities count, when it isn't one of each. */
  unit?: string;
  /** Where it's kept: a location's name, and how many. */
  kept: [string, number];
  /** On a robot: the robot's and subsystem's place in the setup's lists, and how many. */
  inUse?: [number, number, number];
  listing?: { vendor: string; sku: string; url?: string; priceCents: number };
};

const ENTRIES: Entry[] = [
  {
    name: "Swerve module",
    type: "Motion",
    kept: ["Shelves", 2],
    inUse: [0, 0, 4],
    listing: { vendor: "WCP", sku: "WCP-0451", url: SAFE_TEXT.url[0], priceCents: 39_999 },
  },
  {
    name: "Kraken motor",
    type: "Motors",
    kept: ["Cabinets", 3],
    inUse: [0, 1, 2],
    listing: {
      vendor: "CTR Electronics",
      sku: "WCP-0940",
      url: SAFE_TEXT.url[3],
      priceCents: 19_999,
    },
  },
  {
    name: "Robot battery",
    type: "Electronics",
    kept: ["Pit cart", 6],
    listing: { vendor: "AndyMark", sku: "am-3541", priceCents: 6_499 },
  },
  { name: "Hex shaft spacer", type: "Hardware", size: "1/2 in hex", kept: ["Shelves", 40] },
  { name: "Gusset", type: "Hardware", size: "1/8 in", kept: ["Shelves", 18], inUse: [1, 0, 6] },
  { name: "Bumper bracket", type: "Hardware", kept: ["Storage", 8] },
  { name: "Intake roller", type: "Motion", size: "2 in", kept: ["Workbench", 4], inUse: [0, 1, 2] },
  { name: "Climber hook", type: "Other", kept: ["Storage", 2], inUse: [0, 4, 2] },
  { name: "Shooter flywheel", type: "Motion", size: "4 in", kept: ["Cabinets", 2] },
  { name: "Battery mount", type: "Hardware", kept: ["Shelves", 3], inUse: [0, 5, 1] },
  { name: "Motor plate", type: "Hardware", kept: ["Workbench", 5] },
  { name: "Side plate", type: "Raw stock", size: "1/8 in", kept: ["Storage", 10] },
  {
    name: "Socket head screw",
    type: "Hardware",
    size: "10-32 x 1/2 in",
    kept: ["Shelves", 250],
    listing: {
      vendor: "McMaster-Carr",
      sku: "91251A540",
      url: SAFE_TEXT.url[4],
      priceCents: 1_150,
    },
  },
  { name: "Nylock nut", type: "Hardware", size: "10-32", kept: ["Shelves", 300] },
  { name: "Bearing", type: "Motion", size: "1/2 in hex", kept: ["Cabinets", 24] },
  { name: "Pneumatic cylinder", type: "Pneumatics", kept: ["Cabinets", 2] },
  {
    name: "Spark MAX",
    type: "Electronics",
    kept: ["Cabinets", 4],
    listing: { vendor: "REV Robotics", sku: "REV-11-2158", priceCents: 9_000 },
  },
  { name: "Calipers", type: "Tools", kept: ["Workbench", 2] },
  { name: "Drill bit set", type: "Tools", kept: ["Workbench", 1] },
  { name: "Zip ties", type: "Other", kept: ["Pit cart", 500] },
  {
    name: "Signal wire",
    type: "Electronics",
    size: "22 AWG",
    unit: "ft",
    kept: ["Pit cart", 150],
    inUse: [0, 5, 12],
  },
  { name: "Polycarbonate", type: "Raw stock", size: "1/8 in", unit: "sheet", kept: ["Storage", 3] },
  { name: "Hex shaft", type: "Raw stock", size: "1/2 in hex", unit: "in", kept: ["Storage", 108] },
];

export async function loadDemo(db: Db, teamId: string) {
  await loadSetup(db, teamId, starterSetup(), true);
  for (const [name, title] of Object.entries(TITLES)) {
    await db
      .update(locations)
      .set({ title })
      .where(inTeam(locations, teamId, eq(locations.name, name)));
  }
  const [places, fieldRows, robotRows, subsystemRows] = await Promise.all([
    loadLocations(db, teamId),
    db.select().from(fields).where(inTeam(fields, teamId)).orderBy(asc(fields.sortOrder)).all(),
    db.select().from(robots).where(inTeam(robots, teamId)).orderBy(asc(robots.sortOrder)).all(),
    db
      .select()
      .from(subsystems)
      .where(inTeam(subsystems, teamId))
      .orderBy(asc(subsystems.sortOrder))
      .all(),
  ]);
  const placeId = (name: string) => (places.find((p) => p.name === name) ?? places[0])?.id;
  const typeField = fieldRows.find((f) => f.name === "Type");
  const sizeField = fieldRows.find((f) => f.name === "Size");
  const who = DEMO_PEOPLE[1] as DemoPerson;
  const now = Date.now();

  for (const [i, entry] of ENTRIES.entries()) {
    const values: Record<string, string> = {};
    if (typeField) values[typeField.id] = entry.type;
    if (sizeField && entry.size) values[sizeField.id] = entry.size;
    const createdAt = now - (60 - i) * 24 * 60 * 60 * 1000;
    const [item] = await db
      .insert(items)
      .values(
        withTeam(teamId, {
          name: entry.name,
          unit: entry.unit ?? "",
          fieldValues: JSON.stringify(values),
          createdById: who.id,
          createdByName: who.name,
          createdAt,
          updatedAt: createdAt,
        }),
      )
      .returning({ id: items.id });
    const home = placeId(entry.kept[0]);
    if (home === undefined) continue;
    await db.insert(stock).values(
      withTeam(teamId, {
        itemId: item.id,
        locationId: home,
        status: "storage",
        quantity: entry.kept[1],
        countedAt: createdAt,
        countedByName: who.name,
        updatedAt: createdAt,
      }),
    );
    const robot = entry.inUse && robotRows[entry.inUse[0]];
    const subsystem = entry.inUse && subsystemRows[entry.inUse[1]];
    if (entry.inUse && robot && subsystem) {
      await db.insert(stock).values(
        withTeam(teamId, {
          itemId: item.id,
          locationId: home,
          status: "in_use",
          robotId: robot.id,
          subsystemId: subsystem.id,
          quantity: entry.inUse[2],
          updatedAt: createdAt,
        }),
      );
    }
    if (entry.listing) {
      await db.insert(itemListings).values(
        withTeam(teamId, {
          itemId: item.id,
          vendor: entry.listing.vendor,
          sku: entry.listing.sku,
          name: entry.name,
          url: entry.listing.url ?? null,
          priceCents: entry.listing.priceCents,
          priceAt: createdAt,
          createdAt,
        }),
      );
    }
    await db.insert(itemEvents).values(
      withTeam(teamId, {
        itemId: item.id,
        action: "created",
        note: `${formatQuantity(entry.kept[1], entry.unit ?? "")} in ${entry.kept[0]}`,
        userId: who.id,
        userName: who.name,
        createdAt,
      }),
    );
  }
  return { entries: ENTRIES.length };
}

/** The words in the demo's Inventory data and its setup, for the gateway. */
export const demoWords = (): string[] => vocabularyOf(ENTRIES, starterSetup());
