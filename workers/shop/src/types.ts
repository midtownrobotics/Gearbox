import type { G3AuthVariables } from "@g3/auth";

export type AppEnv = {
  Bindings: {
    /** The dev gateway (http://localhost:8796), so links to a team's pages stay local. */
    LOCAL_GATEWAY_URL?: string;
    SESSIONS: KVNamespace;
    SHOP_DB: D1Database;
    G3ID: Fetcher;
    /** Encrypts each team's Onshape keys in D1 (encryptSecret in @g3/auth). */
    SECRETS_KEY?: string;
    /**
     * The site team's Onshape keys from before teams (lib/onshape-config.ts): used for it until an
     * admin saves its own on the Admin page. Other teams only ever use their saved ones.
     */
    ONSHAPE_API_KEY?: string;
    ONSHAPE_API_SECRET?: string;
    ONSHAPE_COMPANY_ID?: string;
    ONSHAPE_WEBHOOK_KEY_PRIMARY?: string;
    ONSHAPE_WEBHOOK_KEY_SECONDARY?: string;
    /** workers/edge, for printing through the edge box. */
    EDGE: Fetcher;
    DRAWINGS: R2Bucket;
    BOM_QUEUE: Queue;
  };
  Variables: G3AuthVariables;
};
