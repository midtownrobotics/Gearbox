import { contrastRatio, isHexColor } from "./color.ts";
import { site } from "./site.ts";
import { teamLinks, teamLinksFor, toolLinks } from "./team-links.ts";

export const teamUiLinkLabels = {
  frcToolsOrders: "FRCTools Orders",
  frcBom: "FRCBOM",
  publicSite: "Public site",
  slack: "Slack",
  github: "GitHub",
  instagram: "Instagram",
  frcEvents: "FRC-Events",
  blueAlliance: "The Blue Alliance",
  statbotics: "Statbotics",
  match13: "match13",
} as const;

export type TeamUiLinkKey = keyof typeof teamUiLinkLabels;

/** The team's own apps on Portal's grid (the sign-in app is named after the team: "G3ID"). */
export const portalAppLabels = {
  id: "ID",
  shop: "Shop",
  pit: "Pit",
  skillTree: "Skill Tree",
  scouting: "Scouting",
  orders: "Orders",
  inventory: "Inventory",
  schedule: "Schedule",
  edge: "Edge",
} as const;

/** A tile on Portal's grid: one of the team's apps, or one of its links. */
export type PortalTileKey = keyof typeof portalAppLabels | TeamUiLinkKey;

/** The grid's order before a team changes it: the apps, then the tools, then the team's links. */
export const defaultAppOrder: PortalTileKey[] = [
  ...(Object.keys(portalAppLabels) as (keyof typeof portalAppLabels)[]),
  "frcToolsOrders",
  "frcBom",
  "publicSite",
  "slack",
  "github",
  "instagram",
  "frcEvents",
  "blueAlliance",
  "statbotics",
  "match13",
];

const portalTiles = new Set<string>(defaultAppOrder);
export const isPortalTileKey = (key: unknown): key is PortalTileKey =>
  typeof key === "string" && portalTiles.has(key);

/**
 * A saved grid order made whole: its tiles in its order (unknown ones and repeats dropped), then
 * any it doesn't name, in their default places' order (a tile added after the team saved).
 */
export function completeAppOrder(order: readonly unknown[]): PortalTileKey[] {
  const known = order.filter(isPortalTileKey).filter((key, i, all) => all.indexOf(key) === i);
  return [...known, ...defaultAppOrder.filter((key) => !known.includes(key))];
}

/**
 * A team's editable appearance (G3ID's Team Appearance page), loaded by every page at runtime for
 * the team its address is for. Identity (the team's number, its addresses) comes from the address.
 */
export type TeamUiSettings = {
  name: string;
  shortName: string;
  logoUrl: string;
  displayFont: "Agency FB" | "Ubuntu" | "system-ui";
  defaultTheme: "system" | "light" | "dark";
  /**
   * Whether the editor keeps the light and dark accents on one hue (each with its own saturation
   * and brightness). Only the editor reads it: the two accents are saved as they are.
   */
  linkAccents: boolean;
  light: TeamUiColors;
  dark: TeamUiColors;
  /** The text on buttons and other fills in the team's color, chosen for each theme. */
  buttonText: Record<"light" | "dark", ButtonText>;
  links: Record<TeamUiLinkKey, string>;
  hiddenLinks: TeamUiLinkKey[];
  /** The order of Portal's tiles (every tile, once; `completeAppOrder` fills in new ones). */
  appOrder: PortalTileKey[];
};

export type TeamUiColors = {
  page: string;
  surface: string;
  inset: string;
  line: string;
  text: string;
  muted: string;
  /**
   * The team's color in this theme: its buttons and other fills (`fillColor`), links and
   * highlights. The light accent is also its brand color (`brandColor`), which app icons take in
   * both themes.
   */
  accent: string;
};

/**
 * The text on a fill in the team's color: light (the dark palette's text color), dark (the light
 * palette's), or whichever of the two stands out more against the fill.
 */
export type ButtonText = "auto" | "light" | "dark";
export const buttonTextChoices: ButtonText[] = ["auto", "light", "dark"];

/**
 * The brand color built into the apps: what the primary palette (`packages/ui/src/index.css`)
 * and the app icon files are drawn in.
 */
export const builtInBrandColor = "#a32035";

/**
 * A team's brand color, for the primary palette and the app icons: its light accent. A team
 * that keeps the default accent keeps the built-in palette and icons exactly as drawn.
 */
export function brandColor(settings: Pick<TeamUiSettings, "light">): string {
  const accent = settings.light.accent.toLowerCase();
  return accent === defaultTeamUiSettings.light.accent ? builtInBrandColor : accent;
}

/**
 * The color of buttons and other solid fills in one theme: that theme's accent (in light mode the
 * brand color, so the default accent keeps the built-in palette).
 */
export function fillColor(
  settings: Pick<TeamUiSettings, "light" | "dark">,
  mode: "light" | "dark",
): string {
  return mode === "dark" ? settings.dark.accent.toLowerCase() : brandColor(settings);
}

/**
 * The color of text on a fill in the team's color (buttons, selected tabs) in one theme, from the
 * team's choice for that theme (`buttonText`). "auto" compares the two text colors against that
 * theme's fill (`fillColor`); the light one wins a tie.
 */
export function buttonTextColor(
  settings: Pick<TeamUiSettings, "light" | "dark"> & Partial<Pick<TeamUiSettings, "buttonText">>,
  mode: "light" | "dark",
): string {
  const light = settings.dark.text;
  const dark = settings.light.text;
  // Settings from a page or a G3ID older than the choice have none: automatic.
  const choice = settings.buttonText?.[mode] ?? "auto";
  if (choice === "light") return light;
  if (choice === "dark") return dark;
  const fill = fillColor(settings, mode);
  // A color still being typed in the editor can't be compared.
  if (![fill, light, dark].every(isHexColor)) return light;
  return contrastRatio(dark, fill) > contrastRatio(light, fill) ? dark : light;
}

export const defaultTeamUiSettings: TeamUiSettings = {
  name: site.team.name,
  shortName: site.team.shortName,
  logoUrl: "",
  displayFont: "Agency FB",
  defaultTheme: "system",
  linkAccents: true,
  light: {
    page: "#f4f6f7",
    surface: "#ffffff",
    inset: "#eef1f3",
    line: "#dde2e5",
    text: "#0c0c0c",
    muted: "#57646c",
    accent: "#a71433",
  },
  dark: {
    page: "#171717",
    surface: "#262626",
    inset: "#1e1e1e",
    line: "#3a3a3a",
    text: "#f4f4f5",
    muted: "#a3a3a3",
    accent: "#e8677c",
  },
  buttonText: { light: "auto", dark: "auto" },
  links: {
    publicSite: site.publicSiteUrl,
    slack: site.links.slack,
    github: site.links.github,
    instagram: site.links.instagram,
    ...teamLinks,
    ...toolLinks,
  },
  hiddenLinks: [],
  appOrder: defaultAppOrder,
};

/**
 * A team's appearance before its admins change anything: the site team's from site.ts (above), and
 * for any other team its own name, its number as the short name ("9999 SHOP"), the FRC links for its
 * number, and the shared colors. `name` is the team's registered name, when known.
 */
export function teamUiDefaults(teamId: string, name?: string): TeamUiSettings {
  if (teamId === `frc${site.team.number}`) return defaultTeamUiSettings;
  const number = Number(teamId.replace(/^frc/, ""));
  return {
    ...defaultTeamUiSettings,
    name: name ?? `Team ${number}`,
    shortName: String(number),
    links: {
      publicSite: "",
      slack: "",
      github: "",
      instagram: "",
      ...teamLinksFor(number),
      ...toolLinks,
    },
  };
}
