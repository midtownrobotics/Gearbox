import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    /** This worker's public base URL as the browser sees it (OAuth callbacks). */
    PUBLIC_API_URL: string;
    G3ID: Fetcher;
    /** workers/edge, which runs part lookups on the shop's edge box. */
    EDGE: Fetcher;
    /** workers/inventory, where received parts can be put. Orders works without it. */
    INVENTORY?: Fetcher;
    ORDERS_DB: D1Database;
    /** Approval DMs are skipped when unset. */
    SLACK_BOT_TOKEN?: string;
  };
  Variables: G3AuthVariables;
};
