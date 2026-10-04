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
   * Each app's subdomain (`web`): the app and its API (at /api) are served there by the gateway
   * worker. `api` is the app's older, separate API hostname, which the gateway still answers so
   * services set up with it (sign-in callbacks, Slack, webhooks) keep working; null for none.
   */
  apps: {
    id: { web: "g3id", api: "api.g3id" },
    portal: { web: "gearbox", api: null },
    shop: { web: "shop", api: "api.shop" },
    pit: { web: "pit", api: "api.pit" },
    orders: { web: "orders", api: "api.orders" },
    edge: { web: "edge", api: "api.edge" },
    scouting: { web: "scouting", api: "api.scouting" },
    skillTree: { web: "skilltree", api: "api.skilltree" },
    attendance: { web: "signin.attendance", api: "api.attendance" },
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

  /** Your Slack app's display name, which G3ID's sign-in asks people to message. */
  slackBotName: "G3 Bot",
} as const;
