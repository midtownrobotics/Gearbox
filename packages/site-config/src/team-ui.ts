import { site } from "./site.ts";
import { teamLinks } from "./team-links.ts";

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

/** Editable presentation settings. Deployment identity (team number, hosts, OAuth) stays in site.ts. */
export type TeamUiSettings = {
  name: string;
  shortName: string;
  logoUrl: string;
  displayFont: "Agency FB" | "Ubuntu" | "system-ui";
  defaultTheme: "system" | "light" | "dark";
  primaryColor: string;
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
  accent: string;
};

export const defaultTeamUiSettings: TeamUiSettings = {
  name: site.team.name,
  shortName: site.team.shortName,
  logoUrl: "",
  displayFont: "Agency FB",
  defaultTheme: "system",
  primaryColor: "#a32035",
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
