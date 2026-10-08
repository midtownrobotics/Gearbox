import type { AppName } from "@g3/site-config";

// What each app tells the platform about itself (roadmap 4.1). Every app has one, in
// `workers/<app>/src/manifest.ts` (exported as `@g3/worker-<app>/manifest`); the platform
// builds its app library from them (workers/platform/src/registry.ts), so a deploy is what changes
// the library. The settings schema and optional plugins (4.5) come later.

/** The roles an app gives a meaning to. */
export type AppRole = "admin" | "mentor" | "member" | "kiosk";

/** Something outside the app that it uses when the team has it. */
export type AppIntegration =
  | "slack"
  | "edge box"
  | "onshape"
  | "share-a-cart"
  | "the blue alliance";

export type AppManifest = {
  /** The app's name in site.ts: its address (<number>-<app>) and its key everywhere. */
  slug: AppName;
  name: string;
  /** One sentence for the app library. */
  summary: string;
  roles: AppRole[];
  integrations: AppIntegration[];
  /**
   * Who may switch it on: every team, or only the site's own team (an app whose data isn't kept
   * per team yet).
   */
  availability: "every team" | "site team";
  /** Always on, for every team (sign-in, the team's home): never in the library. */
  alwaysOn?: true;
  /** The app's version, from its worker's package.json. */
  version: string;
  /**
   * The app's internal routes the platform calls, over its service binding:
   * - `seed`: `POST /api/internal/teams/:id/seed` when the team switches it on. It must be safe to
   *   run again (a team switching it off and on again keeps what it had).
   * - `delete`: `DELETE /api/internal/teams/:id` when a team switched off for its grace period is
   *   cleared, or the team is deleted. Without it, the app's data is kept.
   */
  hooks: { seed: boolean; delete: boolean };
};

export function defineManifest(manifest: AppManifest): AppManifest {
  return manifest;
}
