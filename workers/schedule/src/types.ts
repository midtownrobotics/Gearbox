// SPDX-License-Identifier: AGPL-3.0-only
import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    SCHEDULE_DB: D1Database;
    G3ID: Fetcher;
  };
  Variables: G3AuthVariables;
};
