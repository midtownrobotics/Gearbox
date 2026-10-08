import {
  type TeamUiColors,
  type TeamUiSettings,
  builtInBrandColor,
  completeAppOrder,
  defaultTeamUiSettings,
  isHexColor,
  isPortalTileKey,
  teamUiDefaults,
  withHueOf,
} from "@g3/site-config";
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { teamUiSettings, teams } from "../db/schema";

const fields: (keyof TeamUiColors)[] = [
  "page",
  "surface",
  "inset",
  "line",
  "text",
  "muted",
  "accent",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isColors(value: unknown): value is TeamUiColors {
  return (
    isRecord(value) &&
    fields.every((field) => {
      const color = value[field];
      return typeof color === "string" && isHexColor(color);
    })
  );
}

function isLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Reject extra keys too, so an older editor cannot silently overwrite future settings. */
function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

export function isTeamUiSettings(value: unknown): value is TeamUiSettings {
  if (!isRecord(value) || !hasKeys(value, Object.keys(defaultTeamUiSettings))) return false;
  if (!isRecord(value.links) || !hasKeys(value.links, Object.keys(defaultTeamUiSettings.links)))
    return false;
  return (
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 100 &&
    typeof value.shortName === "string" &&
    value.shortName.trim().length > 0 &&
    value.shortName.length <= 24 &&
    isLink(value.logoUrl) &&
    ["Agency FB", "Ubuntu", "system-ui"].includes(String(value.displayFont)) &&
    ["system", "light", "dark"].includes(String(value.defaultTheme)) &&
    typeof value.linkAccents === "boolean" &&
    isColors(value.light) &&
    isColors(value.dark) &&
    Array.isArray(value.hiddenLinks) &&
    new Set(value.hiddenLinks).size === value.hiddenLinks.length &&
    value.hiddenLinks.every(
      (key) =>
        typeof key === "string" &&
        Object.prototype.hasOwnProperty.call(defaultTeamUiSettings.links, key),
    ) &&
    Object.values(value.links).every(isLink) &&
    // Every tile of Portal's grid, once each, in the team's order.
    Array.isArray(value.appOrder) &&
    value.appOrder.every(isPortalTileKey) &&
    completeAppOrder(value.appOrder).length === value.appOrder.length &&
    new Set(value.appOrder).size === value.appOrder.length
  );
}

/**
 * A record saved when the brand color was a setting of its own (`primaryColor`), as one saved
 * now, where the light accent is the brand color. A brand color the team chose becomes its light
 * accent, so its buttons, links and icons stay the color they were; a dark accent it never chose
 * is turned to that color's hue. The built-in brand color meant "not chosen": the accents stay
 * as saved.
 */
function withoutPrimaryColor(value: Record<string, unknown>): Record<string, unknown> {
  if (!("primaryColor" in value)) return value;
  const { primaryColor, ...rest } = value;
  const { light, dark } = rest;
  if (
    typeof primaryColor !== "string" ||
    !isHexColor(primaryColor) ||
    primaryColor.toLowerCase() === builtInBrandColor ||
    !isColors(light) ||
    !isColors(dark)
  )
    return rest;
  const darkUnchosen = dark.accent.toLowerCase() === defaultTeamUiSettings.dark.accent;
  return {
    ...rest,
    light: { ...light, accent: primaryColor },
    dark: darkUnchosen ? { ...dark, accent: withHueOf(dark.accent, primaryColor) } : dark,
  };
}

/**
 * A stored record, with `defaults` (the team's, teamUiDefaults) filling links and settings added
 * since it was saved, without losing its branding or its explicitly empty links. Writes still need
 * the full current schema, and unknown keys stay invalid.
 */
export function readTeamUiSettings(
  json: string | undefined,
  defaults: TeamUiSettings = defaultTeamUiSettings,
): TeamUiSettings {
  if (!json) return defaults;
  try {
    const value: unknown = JSON.parse(json);
    if (!isRecord(value) || !isRecord(value.links)) return defaults;
    const stored = withoutPrimaryColor(value);
    const settings = {
      ...stored,
      linkAccents: "linkAccents" in stored ? stored.linkAccents : defaults.linkAccents,
      links: { ...defaults.links, ...value.links },
      hiddenLinks: "hiddenLinks" in value ? value.hiddenLinks : [],
      // Saved before the grid could be reordered: the default order. Saved before a tile
      // existed: that tile in its default place.
      appOrder: Array.isArray(value.appOrder)
        ? completeAppOrder(value.appOrder)
        : defaults.appOrder,
    };
    return isTeamUiSettings(settings) ? settings : defaults;
  } catch {
    return defaults;
  }
}

/** A team's appearance: what its admins saved, or its defaults (its own name and number). */
export async function loadTeamUi(db: Db, teamId: string) {
  const [row, team] = await Promise.all([
    db
      .select({ settingsJson: teamUiSettings.settingsJson, updatedAt: teamUiSettings.updatedAt })
      .from(teamUiSettings)
      .where(eq(teamUiSettings.teamId, teamId))
      .get(),
    db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).get(),
  ]);
  const defaults = teamUiDefaults(teamId, team?.name);
  return {
    settings: row ? readTeamUiSettings(row.settingsJson, defaults) : defaults,
    defaults,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** The team's name for its sign-in app ("G3ID"), from its appearance: for messages it's sent. */
export async function teamIdName(db: Db, teamId: string): Promise<string> {
  return `${(await loadTeamUi(db, teamId)).settings.shortName}ID`;
}
