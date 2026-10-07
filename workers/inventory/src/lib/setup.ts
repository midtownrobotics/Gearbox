import { asc } from "drizzle-orm";
import starter from "../../content/starter-setup.json";
import type { Db } from "../db";
import { FIELD_TYPES, type FieldType, fields, robots, subsystems } from "../db/schema";
import { loadFields } from "./fields";
import { chunks, sameName } from "./input";
import { MAX_DEPTH, indexLocations, loadLocations } from "./locations";

// A setup file: how a team has Inventory arranged (its fields, its tree of locations, its robots
// and subsystems), without any of its parts. The app itself holds none of this. A team builds its
// setup on the Settings page, can save it to a file, and can load a file: its own, another team's,
// or the starter that comes with the app (content/starter-setup.json).
//
// Loading only ever adds. What a file names that the team doesn't have yet is added; what the
// team already has (matched by name) is left as it is, and nothing is removed, so loading a file
// can't lose where parts are.

export const SETUP_FORMAT = "gearbox-inventory-setup";
export const SETUP_VERSION = 1;

export type SetupField = {
  name: string;
  type: FieldType;
  /** A choice field's choices. */
  options: string[];
  showInTable: boolean;
};

export type SetupLocation = { name: string; children: SetupLocation[] };

export type Setup = {
  format: typeof SETUP_FORMAT;
  version: typeof SETUP_VERSION;
  fields: SetupField[];
  locations: SetupLocation[];
  robots: string[];
  subsystems: string[];
};

/** What loading a file adds (or would add). */
export type SetupSummary = {
  fields: number;
  /** Choices added to choice fields the team already has. */
  choices: number;
  locations: number;
  robots: number;
  subsystems: number;
  /** Things in the file the team already has. */
  already: number;
};

export const MAX_NAME = 80;
export const MAX_FIELDS = 60;
export const MAX_CHOICES = 200;
export const MAX_LOCATIONS = 5000;
export const MAX_ROBOTS = 100;
export const MAX_SUBSYSTEMS = 200;
const MAX_PROBLEMS = 25;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a file's contents. Gives back the setup with every optional part filled in, or what's
 * wrong with it, in words an admin can act on.
 */
export function parseSetup(input: unknown): { setup: Setup } | { problems: string[] } {
  if (!isObject(input) || input.format !== SETUP_FORMAT) {
    return {
      problems: [`This isn't an Inventory setup file: its "format" must be "${SETUP_FORMAT}".`],
    };
  }
  if (input.version !== SETUP_VERSION) {
    return {
      problems: [
        `This file is version ${String(input.version)}. Only version ${SETUP_VERSION} can be loaded.`,
      ],
    };
  }

  const problems: string[] = [];
  const fail = (where: string, what: string) => problems.push(`${where}: ${what}`);

  const name = (value: unknown, where: string) => {
    if (typeof value !== "string" || !value.trim()) {
      fail(where, `"name" is missing.`);
      return "";
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_NAME) fail(where, `"name" is longer than ${MAX_NAME} characters.`);
    return trimmed;
  };
  const list = (value: unknown, max: number, where: string, what: string) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      fail(where, `"${what}" must be a list.`);
      return [];
    }
    if (value.length > max) fail(where, `"${what}" has more than ${max} entries.`);
    return value.slice(0, max) as unknown[];
  };
  /** Names once each: a repeat among siblings is a problem. */
  const unique = (names: string[], where: string) => {
    const seen = new Set<string>();
    for (const item of names) {
      const key = item.toLowerCase();
      if (item && seen.has(key)) fail(where, `"${item}" is listed twice.`);
      seen.add(key);
    }
  };
  /** A plain list of names (robots, subsystems, a field's choices). */
  const names = (value: unknown, max: number, where: string, what: string) => {
    const out = list(value, max, where, what).map((item, i) => {
      if (typeof item === "string") return name(item, `${where}, ${what} ${i + 1}`);
      // { "name": "..." } is accepted too.
      return name(isObject(item) ? item.name : undefined, `${where}, ${what} ${i + 1}`);
    });
    unique(out, `${where}, ${what}`);
    return out;
  };

  const setupFields = list(input.fields, MAX_FIELDS, "File", "fields").map((raw, i) => {
    const where = `Field ${i + 1}`;
    if (!isObject(raw)) {
      fail(where, "must be an object.");
      return { name: "", type: "text" as FieldType, options: [], showInTable: true };
    }
    const fieldName = name(raw.name, where);
    const label = fieldName ? `Field "${fieldName}"` : where;
    const type = FIELD_TYPES.find((t) => t === raw.type);
    if (!type) fail(label, `"type" must be one of: ${FIELD_TYPES.join(", ")}.`);
    const options = type === "choice" ? names(raw.options, MAX_CHOICES, label, "options") : [];
    if (type === "choice" && options.length === 0) fail(label, "a choice field needs options.");
    return {
      name: fieldName,
      type: type ?? "text",
      options,
      showInTable: raw.showInTable !== false,
    };
  });
  unique(
    setupFields.map((field) => field.name),
    "Fields",
  );

  let locationCount = 0;
  const location = (raw: unknown, where: string, depth: number): SetupLocation => {
    locationCount++;
    // "A1" is short for { "name": "A1" }.
    if (typeof raw === "string") return { name: name(raw, where), children: [] };
    if (!isObject(raw)) {
      fail(where, "must be a name or an object.");
      return { name: "", children: [] };
    }
    const locationName = name(raw.name, where);
    const label = locationName ? `Location "${locationName}"` : where;
    const inside = list(raw.children, MAX_LOCATIONS, label, "children");
    if (inside.length > 0 && depth >= MAX_DEPTH) {
      fail(label, `locations can only be ${MAX_DEPTH} levels deep.`);
      return { name: locationName, children: [] };
    }
    const children = inside.map((child, i) =>
      problems.length > MAX_PROBLEMS
        ? { name: "", children: [] }
        : location(child, `${label}, child ${i + 1}`, depth + 1),
    );
    unique(
      children.map((child) => child.name),
      label,
    );
    return { name: locationName, children };
  };
  const setupLocations = list(input.locations, MAX_LOCATIONS, "File", "locations").map((raw, i) =>
    location(raw, `Location ${i + 1}`, 1),
  );
  unique(
    setupLocations.map((item) => item.name),
    "Locations",
  );
  if (locationCount > MAX_LOCATIONS) {
    fail("Locations", `there are more than ${MAX_LOCATIONS} in the file.`);
  }

  const setupRobots = names(input.robots, MAX_ROBOTS, "File", "robots");
  const setupSubsystems = names(input.subsystems, MAX_SUBSYSTEMS, "File", "subsystems");

  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_PROBLEMS);
    if (problems.length > shown.length) {
      shown.push(`…and ${problems.length - shown.length} more.`);
    }
    return { problems: shown };
  }
  return {
    setup: {
      format: SETUP_FORMAT,
      version: SETUP_VERSION,
      fields: setupFields,
      locations: setupLocations,
      robots: setupRobots,
      subsystems: setupSubsystems,
    },
  };
}

/** The setup that comes with the app, for a team starting from nothing. */
export function starterSetup(): Setup {
  const parsed = parseSetup(starter);
  if ("problems" in parsed) throw new Error(`Starter setup: ${parsed.problems.join(" ")}`);
  return parsed.setup;
}

/** The team's setup as a file. */
export async function exportSetup(db: Db): Promise<Setup> {
  const [fieldRows, locationRows, robotRows, subsystemRows] = await Promise.all([
    loadFields(db),
    loadLocations(db),
    db.select().from(robots).orderBy(asc(robots.sortOrder), asc(robots.id)).all(),
    db.select().from(subsystems).orderBy(asc(subsystems.sortOrder), asc(subsystems.id)).all(),
  ]);
  const { childrenOf } = indexLocations(locationRows);
  const tree = (parentId: number | null, depth: number): SetupLocation[] =>
    depth > MAX_DEPTH
      ? []
      : (childrenOf.get(parentId) ?? []).map((row) => ({
          name: row.name,
          children: tree(row.id, depth + 1),
        }));
  return {
    format: SETUP_FORMAT,
    version: SETUP_VERSION,
    fields: fieldRows.map(({ name, type, options, showInTable }) => ({
      name,
      type,
      options,
      showInTable,
    })),
    locations: tree(null, 1),
    robots: robotRows.map((row) => row.name),
    subsystems: subsystemRows.map((row) => row.name),
  };
}

const countAll = (nodes: SetupLocation[]): number =>
  nodes.reduce((sum, node) => sum + 1 + countAll(node.children), 0);

/**
 * Adds what's in a setup that the team doesn't have yet, or with `apply` false only counts it.
 * Things are matched by name (among a location's siblings), ignoring case.
 */
export async function loadSetup(
  db: Db,
  d1: D1Database,
  setup: Setup,
  apply: boolean,
): Promise<SetupSummary> {
  const summary: SetupSummary = {
    fields: 0,
    choices: 0,
    locations: 0,
    robots: 0,
    subsystems: 0,
    already: 0,
  };
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  // Fields: new ones go after the team's own. A choice field the team has gains the file's
  // choices it's missing; any other field it has is left alone.
  const haveFields = await db
    .select()
    .from(fields)
    .orderBy(asc(fields.sortOrder), asc(fields.id))
    .all();
  let nextField = haveFields.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  for (const field of setup.fields) {
    const have = haveFields.find((row) => sameName(row.name, field.name));
    if (!have) {
      summary.fields++;
      statements.push(
        d1
          .prepare(
            "INSERT INTO fields (name, type, options, show_in_table, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
          )
          .bind(
            field.name,
            field.type,
            JSON.stringify(field.options),
            field.showInTable ? 1 : 0,
            nextField++,
            now,
          ),
      );
      continue;
    }
    summary.already++;
    if (have.type !== "choice" || field.type !== "choice") continue;
    let options: string[] = [];
    try {
      options = (JSON.parse(have.options) as unknown[]).filter(
        (o): o is string => typeof o === "string",
      );
    } catch {}
    const missing = field.options.filter((o) => !options.some((mine) => sameName(mine, o)));
    if (missing.length === 0) continue;
    summary.choices += missing.length;
    statements.push(
      d1
        .prepare("UPDATE fields SET options = ?2 WHERE id = ?1")
        .bind(have.id, JSON.stringify([...options, ...missing].slice(0, MAX_CHOICES))),
    );
  }

  // Robots and subsystems: plain lists of names.
  for (const [table, wanted, key] of [
    ["robots", setup.robots, "robots"],
    ["subsystems", setup.subsystems, "subsystems"],
  ] as const) {
    const have = await db
      .select()
      .from(table === "robots" ? robots : subsystems)
      .all();
    let next = have.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    for (const wantedName of wanted) {
      if (have.some((row) => sameName(row.name, wantedName))) {
        summary.already++;
        continue;
      }
      summary[key]++;
      statements.push(
        d1
          .prepare(`INSERT INTO ${table} (name, sort_order, created_at) VALUES (?1, ?2, ?3)`)
          .bind(wantedName, next++, now),
      );
    }
  }
  if (apply && statements.length > 0) await d1.batch(statements);

  // Locations, a level at a time: a new location's children need its id.
  const { childrenOf } = indexLocations(await loadLocations(db));
  let level: { parentId: number | null; nodes: SetupLocation[] }[] = [
    { parentId: null, nodes: setup.locations },
  ];
  while (level.length > 0) {
    const next: typeof level = [];
    const adding: { parentId: number | null; node: SetupLocation; sortOrder: number }[] = [];
    for (const { parentId, nodes } of level) {
      const have = childrenOf.get(parentId) ?? [];
      let sortOrder = have.length;
      for (const node of nodes) {
        const mine = have.find((row) => sameName(row.name, node.name));
        if (mine) {
          summary.already++;
          if (node.children.length > 0) next.push({ parentId: mine.id, nodes: node.children });
        } else if (apply) {
          summary.locations++;
          adding.push({ parentId, node, sortOrder: sortOrder++ });
        } else {
          // Nothing under a location that isn't there yet can be there either.
          summary.locations += 1 + countAll(node.children);
        }
      }
    }
    // Four values a row: 25 rows keeps a statement at D1's 100 bound parameters.
    for (const group of chunks(adding, 25)) {
      const { results } = await d1
        .prepare(
          `INSERT INTO locations (parent_id, name, sort_order, created_at) VALUES ${group
            .map(() => "(?, ?, ?, ?)")
            .join(", ")} RETURNING id, parent_id AS parentId, name`,
        )
        .bind(...group.flatMap((row) => [row.parentId, row.node.name, row.sortOrder, now]))
        .all<{ id: number; parentId: number | null; name: string }>();
      for (const row of group) {
        const made = results.find((r) => r.parentId === row.parentId && r.name === row.node.name);
        if (made && row.node.children.length > 0) {
          next.push({ parentId: made.id, nodes: row.node.children });
        }
      }
    }
    level = next;
  }
  return summary;
}
