import { type TeamUiColors, type TeamUiSettings, defaultTeamUiSettings } from "@g3/site-config";

const hex = /^#[0-9a-fA-F]{6}$/;
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
    fields.every((field) => typeof value[field] === "string" && hex.test(value[field]))
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
    typeof value.primaryColor === "string" &&
    hex.test(value.primaryColor) &&
    isColors(value.light) &&
    isColors(value.dark) &&
    Object.values(value.links).every(isLink)
  );
}

export function readTeamUiSettings(json: string | undefined): TeamUiSettings {
  if (!json) return defaultTeamUiSettings;
  try {
    const value: unknown = JSON.parse(json);
    return isTeamUiSettings(value) ? value : defaultTeamUiSettings;
  } catch {
    return defaultTeamUiSettings;
  }
}
