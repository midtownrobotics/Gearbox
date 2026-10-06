import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    PLATFORM_DB: D1Database;
    G3ID: Fetcher;
    /** The Slack app (G3ID's): installed into a team's workspace during sign-up. */
    SLACK_CLIENT_ID: string;
    SLACK_CLIENT_SECRET?: string;
    /** Local dev only: the dev gateway (http://localhost:8796), for the platform's and teams' addresses. */
    LOCAL_GATEWAY_URL?: string;
  };
  /** The signed-in user, on the operators' console (`requireAuth` from @g3/auth). */
  Variables: G3AuthVariables;
};
