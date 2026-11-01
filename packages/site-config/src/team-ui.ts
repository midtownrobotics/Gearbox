import { contrastRatio, isHexColor } from "./color.ts";
import { site } from "./site.ts";
import { teamLinks, teamLinksFor } from "./team-links.ts";

export const teamUiLinkLabels = {
  publicSite: "Public site",
  slack: "Slack",
  discord: "Discord",
  github: "GitHub",
  instagram: "Instagram",
  frcEvents: "FRC-Events",
  blueAlliance: "The Blue Alliance",
  statbotics: "Statbotics",
  match13: "match13",
} as const;

export type TeamUiLinkKey = keyof typeof teamUiLinkLabels;

/**
 * The team's own apps on Portal's grid and in the All Apps menu. ID isn't one: it only signs people
 * in, and a member's account is on Portal.
 */
export const portalAppLabels = {
  shop: "Shop",
  pit: "Pit",
  skillTree: "Skill Tree",
  scouting: "Scouting",
  orders: "Orders",
  inventory: "Inventory",
  schedule: "Schedule",
  attendance: "Attendance",
  edge: "Edge",
} as const;

/**
 * A link a team adds itself (Team Appearance): its own name and address, shown on Portal's grid
 * with the site's own icon (`faviconUrl`).
 */
export type CustomLink = { id: string; label: string; url: string };

/** How many custom links a team can have. */
export const maxCustomLinks = 20;

/** A custom link's tile on Portal's grid. */
export type CustomTileKey = `custom:${string}`;
export const customTileKey = (id: string): CustomTileKey => `custom:${id}`;
export const isCustomLinkId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-z0-9]{1,16}$/.test(id);

/**
 * A site's icon, loaded by the viewer's browser straight from the site (nothing is kept on
 * Gearbox's servers). A site without one gets an error, not an image.
 */
export function faviconUrl(url: string): string | undefined {
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return undefined;
  }
}

/** A tile on Portal's grid: one of the team's apps, one of its links, or a custom link. */
export type PortalTileKey = keyof typeof portalAppLabels | TeamUiLinkKey | CustomTileKey;

/** The grid's order before a team changes it: the apps, then the team's links. */
export const defaultAppOrder: PortalTileKey[] = [
  ...(Object.keys(portalAppLabels) as (keyof typeof portalAppLabels)[]),
  "publicSite",
  "slack",
  "discord",
  "github",
  "instagram",
  "frcEvents",
  "blueAlliance",
  "statbotics",
  "match13",
];

const portalTiles = new Set<string>(defaultAppOrder);
export const isPortalTileKey = (key: unknown): key is PortalTileKey =>
  typeof key === "string" &&
  (portalTiles.has(key) || (key.startsWith("custom:") && isCustomLinkId(key.slice(7))));

/**
 * A saved grid order made whole: its tiles in its order (unknown ones, custom links the team no
 * longer has and repeats dropped), then any it doesn't name, in their default places' order (a
 * tile added after the team saved), then its custom links it doesn't name.
 */
export function completeAppOrder(
  order: readonly unknown[],
  customLinks: readonly Pick<CustomLink, "id">[] = [],
): PortalTileKey[] {
  const all: PortalTileKey[] = [
    ...defaultAppOrder,
    ...customLinks.map((link) => customTileKey(link.id)),
  ];
  const known = order
    .filter((key): key is PortalTileKey => all.includes(key as PortalTileKey))
    .filter((key, i, list) => list.indexOf(key) === i);
  return [...known, ...all.filter((key) => !known.includes(key))];
}

/**
 * A team's editable appearance (G3ID's Team Appearance page), loaded by every page at runtime for
 * the team its address is for. Identity (the team's number, its addresses) comes from the address.
 */
export type TeamUiSettings = {
  name: string;
  shortName: string;
  /** Show the team's avatar from The Blue Alliance (`teamAvatarUrl`) as its logo, in place of the app icons. */
  useAvatar: boolean;
  /** Put the short name in front of the app's name in the top bar ("G3 ORDERS"); off: "ORDERS". */
  prefixAppNames: boolean;
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
  /** Links the team adds itself, each with its own name. */
  customLinks: CustomLink[];
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
  useAvatar: false,
  prefixAppNames: true,
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
    accent: "#a32035",
  },
  dark: {
    page: "#171717",
    surface: "#262626",
    inset: "#1e1e1e",
    line: "#3a3a3a",
    text: "#f4f4f5",
    muted: "#a3a3a3",
    accent: "#bd263e",
  },
  buttonText: { light: "auto", dark: "auto" },
  links: {
    publicSite: site.publicSiteUrl,
    slack: site.links.slack,
    discord: site.links.discord,
    github: site.links.github,
    instagram: site.links.instagram,
    ...teamLinks,
  },
  hiddenLinks: [],
  customLinks: [],
  appOrder: defaultAppOrder,
};

/**
 * A team's avatar: the 40 × 40 px image FIRST teams make each season to be shown at events, from The
 * Blue Alliance, for the current calendar year. A team without one gets an error, not an image.
 */
export function teamAvatarUrl(teamNumber: number, year = new Date().getFullYear()): string {
  return `https://www.thebluealliance.com/avatar/${year}/frc${teamNumber}.png`;
}

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
      discord: "",
      github: "",
      instagram: "",
      ...teamLinksFor(number),
    },
  };
}
