import type { AppManifest } from "@g3/auth";
import type { AppName } from "@g3/site-config";
import { teamKey } from "@g3/site-config";
import { manifest as attendance } from "@g3/worker-attendance/manifest";
import { manifest as edge } from "@g3/worker-edge/manifest";
import { manifest as id } from "@g3/worker-g3id/manifest";
import { manifest as inventory } from "@g3/worker-inventory/manifest";
import { manifest as orders } from "@g3/worker-orders/manifest";
import { manifest as pit } from "@g3/worker-pit/manifest";
import { manifest as portal } from "@g3/worker-portal/manifest";
import { manifest as scouting } from "@g3/worker-scouting/manifest";
import { manifest as shop } from "@g3/worker-shop/manifest";
import { manifest as skillTree } from "@g3/worker-skill-tree/manifest";
import type { AppEnv } from "./types";

// The app library (roadmap 4.2): every app's manifest, built into this worker, so deploying the
// platform is what updates it. Which apps each team has switched on is the `team_apps` table.

export const MANIFESTS: Record<AppName, AppManifest> = {
  id,
  portal,
  shop,
  pit,
  orders,
  edge,
  scouting,
  skillTree,
  attendance,
  inventory,
};

/** Each app's service binding here, for its seed and delete hooks. */
const BINDINGS: Partial<Record<AppName, keyof AppEnv["Bindings"]>> = {
  attendance: "ATTENDANCE",
  edge: "EDGE",
  inventory: "INVENTORY",
  orders: "ORDERS",
  pit: "PIT",
  shop: "SHOP",
  skillTree: "SKILL_TREE",
};

export const isAppName = (slug: string): slug is AppName =>
  Object.prototype.hasOwnProperty.call(MANIFESTS, slug);

/** Whether a team may switch an app on. Always-on apps aren't in the library. */
export function inLibrary(app: AppManifest, teamId: string): boolean {
  if (app.alwaysOn) return false;
  return app.availability === "every team" || teamId === teamKey;
}

/** The apps every team has. */
export const ALWAYS_ON = Object.values(MANIFESTS)
  .filter((app) => app.alwaysOn)
  .map((app) => app.slug);

/** The apps that keep data per team and delete it on request (their `delete` hook). */
export const DELETABLE = Object.values(MANIFESTS).filter((app) => app.hooks.delete);

/**
 * Calls an app's hook for a team (its /api/internal/teams/:id routes, which the gateway never
 * answers): true if it answered OK.
 */
export async function callHook(
  env: AppEnv["Bindings"],
  app: AppName,
  hook: "seed" | "delete",
  teamId: string,
): Promise<boolean> {
  const binding = BINDINGS[app];
  if (!binding || !MANIFESTS[app].hooks[hook]) return true;
  const path = `/api/internal/teams/${encodeURIComponent(teamId)}${hook === "seed" ? "/seed" : ""}`;
  try {
    const res = await (env[binding] as Fetcher).fetch(
      new Request(`http://${app}${path}`, { method: hook === "seed" ? "POST" : "DELETE" }),
    );
    if (!res.ok) console.error(`[apps] ${hook} ${app} for ${teamId}`, res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error(`[apps] ${hook} ${app} for ${teamId}`, err);
    return false;
  }
}
