import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    /** The dev gateway (http://localhost:8796), so links to a team's pages stay local. */
    LOCAL_GATEWAY_URL?: string;
    G3ID: Fetcher;
    /** workers/edge, which runs part lookups on the shop's edge box. */
    EDGE: Fetcher;
    /** workers/inventory, where received parts can be put. Orders works without it. */
    INVENTORY?: Fetcher;
    ORDERS_DB: D1Database;
  };
  Variables: G3AuthVariables;
};
