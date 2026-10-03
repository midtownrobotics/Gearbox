import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    SESSIONS: KVNamespace;
    SKILL_DB: D1Database;
    G3ID: Fetcher;
  };
  Variables: G3AuthVariables;
};
