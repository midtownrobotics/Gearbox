import { apiPath } from "@g3/site-config";
import type { G3IDApp } from "@g3/worker-g3id";
import { hc } from "hono/client";

/** User information stays in ID; its account and management pages live in Home. */
export const api = hc<G3IDApp>(apiPath("id"), { init: { credentials: "include" } });
export const g3id = api;
