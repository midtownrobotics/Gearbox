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
   * The team's own domain: its public website. Its apps used to run here
   * (<web>.<domain>, below); those addresses are retired, and the gateway answers them 410 Gone.
   */
  domain: "g3robotics.com",

  /**
   * The platform's domain: its public site and team sign-up at the domain itself, and every team's
   * apps at <number>-<app>.<platform domain>, this file's team included (1648-orders.frcgearbox.com).
   */
  platformDomain: "frcgearbox.com",

  /**
   * Staging (roadmap 0.2), deployed from `main`: every platform address with `suffix` on its first
   * label, on `domain` (1648-orders-dev.g3robotics.com, its platform at dev.g3robotics.com). A
   * domain apart from production's, so the two never share a cookie; the free certificate covers
   * it, since it's one level deep.
   */
  staging: { domain: "g3robotics.com", suffix: "-dev" },

  /**
   * The public demo (roadmap Phase 5): a team anyone can use without an account, at its number's
   * addresses (and demo.<platform domain>), wiped and loaded with sample data every night at
   * midnight in `timeZone`. Sign-up refuses its number. 9999 is FIRST's own placeholder team.
   */
  demo: { teamNumber: 9999, name: "Gearbox Demo", timeZone: "America/New_York" },

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
    schedule: { web: null },
  },

  /** The team's public website, linked from the apps. */
  publicSiteUrl: "https://www.g3robotics.com",

  /** Links on the app list (Gearbox). Leave one empty to hide it. */
  links: {
    slack: "https://g3robotics.slack.com",
    /** The team's Discord invite, for a team on Discord. */
    discord: "",
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
  /**
   * The Discord app's name (one app, added to every team's server), which pages name when the bot
   * needs access to a channel. Keep it the same as the app's name in Discord's settings.
   */
  discordBotName: "Gearbot",
} as const;
