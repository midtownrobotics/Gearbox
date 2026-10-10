import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    /** The Blue Alliance and Nexus API keys every team's monitor uses (secrets). */
    TBA_AUTH_KEY: string;
    NEXUS_API_KEY: string;
    SESSIONS: KVNamespace;
    PIT_DB: D1Database;
    G3ID: Fetcher;
  };
  Variables: G3AuthVariables;
};
