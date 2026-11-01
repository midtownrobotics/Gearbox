// SPDX-License-Identifier: AGPL-3.0-only
import type { G3IDApp } from "@g3/worker-g3id";
import { hc } from "hono/client";

export const api = hc<G3IDApp>(import.meta.env.VITE_API_BASE_URL ?? "", {
  init: { credentials: "include" },
});
