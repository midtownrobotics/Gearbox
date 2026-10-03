import { apiUrl } from "@g3/site-config";
import type { G3IDApp } from "@g3/worker-g3id";
import { hc } from "hono/client";

export const g3id = hc<G3IDApp>(import.meta.env.VITE_G3ID_API_URL ?? apiUrl("id"), {
  init: { credentials: "include" },
});
