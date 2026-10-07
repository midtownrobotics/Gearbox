import type { G3AuthVariables } from "@g3/auth";
import type { AgentLink } from "./lib/agent-link";

export type AppEnv = {
  Bindings: {
    EDGE_DB: D1Database;
    G3ID: Fetcher;
    /** Holds each team's box WebSocket (lib/agent-link.ts), one instance per team. */
    AGENT_LINK: DurableObjectNamespace<AgentLink>;
  };
  Variables: G3AuthVariables;
};

/** Pseudo-client key for total WAN bytes (what the carrier bills). */
export const WAN_KEY = "_wan";
