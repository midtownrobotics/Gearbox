import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    /** The Blue Alliance and Nexus API keys every team's monitor uses (secrets). */
    TBA_AUTH_KEY: string;
    NEXUS_API_KEY: string;
    SESSIONS: KVNamespace;
    PIT_DB: D1Database;
    /** Match logs from the team's log downloaders, in Shop's bucket under pit/teams/<team>/logs/ (match-logs.ts). */
    LOGS: R2Bucket;
    G3ID: Fetcher;
  };
  Variables: G3AuthVariables & {
    /** The paired log downloader a request came from (`requireDownloader`). */
    downloaderId: number;
  };
};
