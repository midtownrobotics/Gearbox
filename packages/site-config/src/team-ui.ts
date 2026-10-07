import { site } from "./site.ts";
import { teamLinks, teamLinksFor } from "./team-links.ts";

export const teamUiLinkLabels = {
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
  links: Record<TeamUiLinkKey, string>;
  hiddenLinks: TeamUiLinkKey[];
};

export type TeamUiColors = {
  page: string;
  surface: string;
  inset: string;
  line: string;
  text: string;
  muted: string;
  /**
   * The team's colour in this theme. The light accent is also its brand colour (`brandColor`):
   * buttons, links and app icons take it in both themes.
   */
  accent: string;
};

/**
 * The brand colour built into the apps: what the primary palette (`packages/ui/src/index.css`)
 * and the app icon files are drawn in.
 */
export const builtInBrandColor = "#a32035";

/**
 * A team's brand colour, for the primary palette and the app icons: its light accent. A team
 * that keeps the default accent keeps the built-in palette and icons exactly as drawn.
 */
export function brandColor(settings: Pick<TeamUiSettings, "light">): string {
  const accent = settings.light.accent.toLowerCase();
  return accent === defaultTeamUiSettings.light.accent ? builtInBrandColor : accent;
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
  links: {
    publicSite: site.publicSiteUrl,
    slack: site.links.slack,
    github: site.links.github,
    instagram: site.links.instagram,
    ...teamLinks,
  },
  hiddenLinks: [],
};

/**
 * A team's appearance before its admins change anything: the site team's from site.ts (above), and
 * for any other team its own name, its number as the short name ("254 SHOP"), the FRC links for its
 * number, and the shared colours. `name` is the team's registered name, when known.
 */
export function teamUiDefaults(teamId: string, name?: string): TeamUiSettings {
  if (teamId === `frc${site.team.number}`) return defaultTeamUiSettings;
  const number = Number(teamId.replace(/^frc/, ""));
  return {
    ...defaultTeamUiSettings,
    name: name ?? `Team ${number}`,
    shortName: String(number),
    links: { publicSite: "", slack: "", github: "", instagram: "", ...teamLinksFor(number) },
  };
}
