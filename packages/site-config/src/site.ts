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

  /**
   * The team's own domain: its public website and the edge box's tunnel. Its apps used to run here
   * (<web>.<domain>, below); those addresses are retired, and the gateway answers them 410 Gone.
   */
  domain: "g3robotics.com",

  /**
   * The platform's domain: its public site and team sign-up at the domain itself, and every team's
   * apps at <number>-<app>.<platform domain>, this file's team included (1648-orders.frcgearbox.com).
   */
  platformDomain: "frcgearbox.com",

  /**
   * Each app, and its old, retired subdomain on `domain` (`web`; null for an app made after the
   * move, which never had one).
   */
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
    inventory: { web: null },
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
