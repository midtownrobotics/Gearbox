import { inTeam, withTeam } from "@g3/auth";
import { and, eq, inArray, like } from "drizzle-orm";
import type { OrdersDb } from "../db";
import { appSettings } from "../db/schema";
import type { FiscalCalendar } from "./fiscal";
import { DEFAULT_TEMPLATE } from "./naming";

// A team's settings: one row per key in app_settings, kept to the team. Mentors edit the ones in
// TeamSettings on the Settings page (PUT /settings); the rest are the app's own bookkeeping
// (Share-A-Cart's connection, whether the starter catalog was copied).

/** A new team's calendar and money until a mentor changes them. G3 has its own rows (0018). */
export const DEFAULTS = {
  currency: "USD",
  /** July: FRC seasons and school years. */
  fiscalYearStart: 7,
};

export type TeamSettings = {
  /** ISO 4217 code for budgets, prices and new requests. */
  currency: string;
  /** 1–12: the month the team's fiscal year (and budgets) start. */
  fiscalYearStart: number;
  /** How new requests are named (lib/naming.ts). */
  namingTemplate: string;
  /** Whether receiving a part must say where it goes in Inventory (lib/inventory.ts). */
  inventoryRequired: boolean;
};

const KEYS = {
  currency: "currency",
  fiscalYearStart: "fiscal_year_start",
  namingTemplate: "naming_template",
  inventoryRequired: "inventory_required",
} as const satisfies Record<keyof TeamSettings, string>;

export async function getSetting(db: OrdersDb, teamId: string, key: string) {
  const row = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(inTeam(appSettings, teamId, eq(appSettings.key, key)))
    .get();
  return row?.value ?? null;
}

export async function putSetting(db: OrdersDb, teamId: string, key: string, value: string) {
  await db
    .insert(appSettings)
    .values(withTeam(teamId, { key, value }))
    .onConflictDoUpdate({ target: [appSettings.teamId, appSettings.key], set: { value } });
}

export async function deleteSetting(db: OrdersDb, teamId: string, key: string) {
  await db.delete(appSettings).where(inTeam(appSettings, teamId, eq(appSettings.key, key)));
}

/** The team's settings whose keys start with `prefix`. */
export async function settingsLike(db: OrdersDb, teamId: string, prefix: string) {
  return db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inTeam(appSettings, teamId, like(appSettings.key, `${prefix}%`)))
    .all();
}

/** Everything a mentor sets, with the defaults filled in. */
export async function teamSettings(db: OrdersDb, teamId: string): Promise<TeamSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(inTeam(appSettings, teamId), inArray(appSettings.key, Object.values(KEYS))))
    .all();
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const start = Number(value(KEYS.fiscalYearStart));
  return {
    currency: value(KEYS.currency) ?? DEFAULTS.currency,
    fiscalYearStart:
      Number.isInteger(start) && start >= 1 && start <= 12 ? start : DEFAULTS.fiscalYearStart,
    namingTemplate: value(KEYS.namingTemplate) ?? DEFAULT_TEMPLATE,
    inventoryRequired: value(KEYS.inventoryRequired) === "true",
  };
}

/** Saves the settings given; the ones left out stay as they are. */
export async function saveTeamSettings(
  db: OrdersDb,
  teamId: string,
  changes: Partial<TeamSettings>,
) {
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    await putSetting(db, teamId, KEYS[name as keyof TeamSettings], String(value));
  }
}

/**
 * The team's fiscal calendar (lib/fiscal.ts) as the person asking sees it: the team's start month,
 * in their own time zone (lib/local-time.ts).
 */
export const calendarOf = (settings: TeamSettings, timeZone: string): FiscalCalendar => ({
  startMonth: settings.fiscalYearStart,
  timeZone,
});

/** Just the calendar, for routes that only need fiscal years. */
export async function teamCalendar(db: OrdersDb, teamId: string, timeZone: string) {
  return calendarOf(await teamSettings(db, teamId), timeZone);
}
