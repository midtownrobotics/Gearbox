import type { G3AuthVariables } from "@g3/auth";
import type { AgentLink } from "./lib/agent-link";

export type AppEnv = {
  Bindings: {
    FRONTEND_URL: string;
    EDGE_DB: D1Database;
    G3ID: Fetcher;
    /** The box's key: it connects with it and sends usage with it. */
    EDGE_AGENT_KEY: string;
    /** Holds the box's WebSocket (lib/agent-link.ts). */
    AGENT_LINK: DurableObjectNamespace<AgentLink>;
  };
  Variables: G3AuthVariables;
};

/** Pseudo-client key for total WAN bytes (what the carrier bills). */
export const WAN_KEY = "_wan";
