// The one file a team edits to run these apps as its own: its name, number and domain. Apps and
// workers import it; wrangler.toml and .env.production values that come from it are written by
// `pnpm configure` (scripts/configure.ts). Run that after changing anything here.

export const site = {
  team: {
    /** FRC team number. */
    number: 1648,
    /** Full name, for text like "<name> parts management". */
    name: "G3 Robotics",
    /** Short name for app wordmarks: "<short name> SHOP", "<short name> PIT". */
    shortName: "G3",
  },

  /** The domain the apps run under: each app at <subdomain>.<domain>. */
  domain: "g3robotics.com",

  /**
   * The platform's domain: its public site and team sign-up at the domain itself, and every other
   * team's apps at <number>-<app>.<platform domain> (this file's team keeps `domain` above).
   */
  platformDomain: "frcgearbox.com",

  /** Each app's subdomain (`web`): the gateway serves the app's page there, and its API at /api. */
  apps: {
    id: { web: "g3id" },
    portal: { web: "gearbox" },
    shop: { web: "shop" },
    pit: { web: "pit" },
    orders: { web: "orders" },
    edge: { web: "edge" },
    scouting: { web: "scouting" },
    skillTree: { web: "skilltree" },
    attendance: { web: "attendance" },
  },

  /** The shop edge box's tunnel hostname (<subdomain>.<domain>), if you run one. */
  edgeAgentSubdomain: "edge-agent",

  /** The team's public website, linked from the apps. */
  publicSiteUrl: "https://www.g3robotics.com",

  /** Links on the app list (Gearbox). Leave one empty to hide it. */
  links: {
    slack: "https://g3robotics.slack.com",
    github: "https://github.com/midtownrobotics",
    instagram: "https://www.instagram.com/g3robotics1648/",
  },

  /** The platform's source code (MIT licensed). */
  sourceUrl: "https://github.com/midtownrobotics/Gearbox",

  /** The platform's terms of service and privacy policy, which a team accepts when it signs up. */
  legal: {
    terms: "https://github.com/midtownrobotics/Gearbox/blob/main/docs/legal/terms-of-service.md",
    privacy: "https://github.com/midtownrobotics/Gearbox/blob/main/docs/legal/privacy-policy.md",
  },

  /**
   * The Slack app's display name (one app, installed into every team's workspace), which sign-in
   * and sign-up ask people to message. Keep it the same as the app's name in Slack's settings.
   */
  slackBotName: "Gearbot",
} as const;
