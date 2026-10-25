import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    /** The dev gateway (http://localhost:8796), for team addresses in dev; unset in production. */
    LOCAL_GATEWAY_URL?: string;
    /** The Blue Alliance and Nexus API keys every team's monitor uses (secrets). */
    TBA_AUTH_KEY: string;
    NEXUS_API_KEY: string;
    SESSIONS: KVNamespace;
    PIT_DB: D1Database;
    /** Match logs from the team's log downloaders, in Shop's bucket under pit/teams/<team>/logs/ (match-logs.ts). */
    LOGS: R2Bucket;
    G3ID: Fetcher;
    /** Schedule, for when the team's events open and close (battery-timers.ts). Optional. */
    SCHEDULE?: Fetcher;
    /** The page's static files (production): AdvantageScope's built-in models go through bundledAsset. */
    ASSETS?: Fetcher;
  };
  Variables: G3AuthVariables & {
    /** The paired log downloader a request came from (`requireDownloader`). */
    downloaderId: number;
  };
};
