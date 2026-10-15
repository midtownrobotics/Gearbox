// A role's color is one of the page's presets (a key, which the page draws as a tint that suits
// light and dark mode) or a color the team chose, written #rrggbb. The presets leave out red,
// which means a problem in every app; a team may still choose it.
export const ROLE_COLORS = [
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "sky",
  "blue",
  "indigo",
  "violet",
  "pink",
  "gray",
] as const;
export type RolePreset = (typeof ROLE_COLORS)[number];
/** A preset's key, or a custom color (#rrggbb). */
export type RoleColor = RolePreset | `#${string}`;

const HEX = /^#[0-9a-f]{6}$/i;

export const isRolePreset = (value: unknown): value is RolePreset =>
  typeof value === "string" && (ROLE_COLORS as readonly string[]).includes(value);

export const isRoleColor = (value: unknown): value is RoleColor =>
  isRolePreset(value) || (typeof value === "string" && HEX.test(value));

/** A color as it's stored: presets as they are, custom colors in lowercase. */
export const normalizeRoleColor = (color: RoleColor): RoleColor =>
  isRolePreset(color) ? color : (color.toLowerCase() as RoleColor);

/** The most roles a team keeps, archived ones included. */
export const MAX_ROLES = 100;
export const MAX_ROLE_NAME = 40;
