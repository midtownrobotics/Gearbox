import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    EDGE_DB: D1Database;
    G3ID: Fetcher;
    EDGE_AGENT_KEY: string;
    /** The agent’s tunnel URL (https://edge-agent.g3robotics.com); unset = don’t poke. */
    EDGE_AGENT_URL?: string;
    /**
     * Dev only: send part lookups to a different agent than everything else, e.g. the real box
     * while printing stays on the mock agent. Unset in production.
     */
    LOOKUP_AGENT_URL?: string;
    LOOKUP_AGENT_KEY?: string;
  };
  Variables: G3AuthVariables;
};

/** Pseudo-client key for total WAN bytes (what the carrier bills). */
export const WAN_KEY = "_wan";
