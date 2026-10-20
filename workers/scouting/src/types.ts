import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    LOCAL_AUTH_BYPASS?: string;
    SCOUTING_DB: D1Database;
    FIELD_MAPS: R2Bucket;
    G3ID: Fetcher;
    /** The team's Schedule app: who's on scouting duty (scout-nudges.ts). */
    SCHEDULE?: Fetcher;
    LOCAL_GATEWAY_URL?: string;
    TBA_AUTH_KEY?: string;
    NEXUS_API_KEY?: string;
    AI: Ai;
  };
  Variables: G3AuthVariables;
};

export type TbaMatch = {
  key: string;
  comp_level: string;
  set_number: number;
  match_number: number;
  time: number | null;
  predicted_time: number | null;
  actual_time: number | null;
  post_result_time?: number | null;
  alliances: {
    red: { team_keys: string[]; score: number };
    blue: { team_keys: string[]; score: number };
  };
};
export type TbaTeam = { key: string; team_number: number; nickname: string | null; name: string };
