export type AppEnv = {
  Bindings: {
    PLATFORM_DB: D1Database;
    G3ID: Fetcher;
    /** The Slack app (G3ID's): installed into a team's workspace during sign-up. */
    SLACK_CLIENT_ID: string;
    SLACK_CLIENT_SECRET?: string;
  };
};
