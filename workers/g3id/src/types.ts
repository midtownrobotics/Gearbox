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
    /** The Slack app's OAuth credentials, for installing it into a team's workspace. */
    SLACK_CLIENT_ID?: string;
    SLACK_CLIENT_SECRET?: string;
    /** Encrypts secrets stored in D1, like each team's Slack bot token (lib/secret-box.ts). */
    SECRETS_KEY?: string;
    STEAM_API_KEY: string;
    STEAM_REDIRECT_URI: string;
    ONSHAPE_CLIENT_ID: string;
    ONSHAPE_CLIENT_SECRET: string;
    ONSHAPE_REDIRECT_URI: string;
    FRONTEND_URL: string;
    /** Local dev only: the dev gateway (http://localhost:8796), for other teams' addresses. */
    LOCAL_GATEWAY_URL?: string;
    ENVIRONMENT?: string;
  };
  Variables: {
    userId?: string;
    kioskDeviceId?: number;
    /** The team of the kiosk the request came from (requireKioskToken). */
    kioskTeamId?: string;
  };
};
