export type AppEnv = {
  Bindings: {
    DB: D1Database;
    SESSIONS: KVNamespace;
    RATE_LIMIT: KVNamespace;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GOOGLE_REDIRECT_URI: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    GITHUB_REDIRECT_URI: string;
    SLACK_BOT_TOKEN: string;
    SLACK_SIGNING_SECRET: string;
    SLACK_TEAM_ID: string;
    SLACK_APP_ID: string;
    STEAM_API_KEY: string;
    STEAM_REDIRECT_URI: string;
    ONSHAPE_CLIENT_ID: string;
    ONSHAPE_CLIENT_SECRET: string;
    ONSHAPE_REDIRECT_URI: string;
    FRONTEND_URL: string;
    ENVIRONMENT?: string;
  };
  Variables: {
    userId?: string;
    kioskDeviceId?: number;
    /** The team of the kiosk the request came from (requireKioskToken). */
    kioskTeamId?: string;
  };
};
