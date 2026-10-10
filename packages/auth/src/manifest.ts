import type { AppName } from "@g3/site-config";

// What each app tells the platform about itself (roadmap 4.1). Every app has one, in
// `workers/<app>/src/manifest.ts` (exported as `@g3/worker-<app>/manifest`); the platform
// builds its app library from them (workers/platform/src/registry.ts), so a deploy is what changes
// the library. It also says what the team can set (`settings`), which optional parts it has
// (`plugins`) and which of the platform's hooks it answers. The team's dashboard (Portal's
// /admin/settings, roadmap 4.5) builds a form from `settings` for each app with `settingsForm`,
// which reads and saves them through the app's own `/team-settings` (`teamSettingsRoutes`).

/** The roles an app gives a meaning to. */
export type AppRole = "admin" | "mentor" | "member" | "kiosk";

/** Something outside the app that it uses when the team has it. */
export type AppIntegration =
  | "slack"
  | "edge box"
  | "onshape"
  | "share-a-cart"
  | "the blue alliance";

/** One of a team's settings for an app, as it stores it (roadmap 4.1). */
export type AppSetting = {
  /** The app's own name for it (its settings row or field). */
  key: string;
  label: string;
  /**
   * How the form shows it and what it accepts: a `month` is 1–12, a `day of year` "MM-DD", a
   * `url` an https link, `bytes` a whole number of bytes (shown in GB).
   */
  type:
    | "text"
    | "number"
    | "boolean"
    | "choice"
    | "month"
    | "day of year"
    | "url"
    | "bytes"
    | "secret";
  /** What a team that never set it gets. Null: nothing (a secret, a link it must enter). */
  default: string | number | boolean | null;
  /** For a `number`: the smallest and largest it takes. */
  min?: number;
  max?: number;
  /** For a `choice`: the values it takes. */
  choices?: { value: string; label: string }[];
  /** A unit or a short note ("hours", "0 means no cap"). */
  help?: string;
  /** Who may change it. */
  editedBy: "admin" | "mentor";
  /**
   * Where it's edited when the team's App settings page can't (an integration's keys, or an app
   * without `settingsForm`): its path in the app, or `<app>:<path>` for a page in another app.
   * A setting the App settings page edits has none: it's edited only there.
   */
  page?: string;
  /**
   * Part of connecting this integration (keys, a box key): set up on `page`, where saving does more
   * than store it (registering a webhook, making a key). The dashboard lists it on its
   * Integrations page, not in the app's settings form.
   */
  integration?: AppIntegration;
  /** Another app it's about: the dashboard leaves it out while the team has that app off. */
  requiresApp?: AppName;
};

/** An optional part of an app a team switches on inside it (Scouting's engagement modules). */
export type AppPlugin = {
  key: string;
  name: string;
  summary: string;
  /** On for a team that never chose. */
  default: boolean;
  /** Plugins it needs on too. */
  requires?: string[];
};

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
   * - `export`: `GET /api/internal/teams/:id/export`, the team's data as a `TeamExport` (JSON,
   *   secrets left out), offered to the team's admins before they switch the app off.
   */
  hooks: { seed: boolean; delete: boolean; export: boolean };
  /** The team's settings for this app (none for an app without any). */
  settings: AppSetting[];
  /**
   * It answers `GET`/`PUT /api/team-settings` (`teamSettingsRoutes`), so the team's dashboard has
   * a form for its settings. False: they're only on its own pages.
   */
  settingsForm: boolean;
  /** Its optional parts, each switched on and off inside the app. */
  plugins: AppPlugin[];
};

export function defineManifest(manifest: AppManifest): AppManifest {
  return manifest;
}
