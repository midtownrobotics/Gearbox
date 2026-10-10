import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { logTeamChange, settingLabels } from "./audit";
import { type G3AuthEnv, hasMentorAccess, requireAuth } from "./g3id";
import type { AppIntegration, AppManifest, AppSetting } from "./manifest";

// The team's settings for one app, in one shape every app shares (roadmap 4.5), by manifest key.
// Each app mounts `teamSettingsRoutes` at `/team-settings` and says how to read and save its own
// settings; this checks who may change what, checks each value by its manifest type, and writes
// the team's log. The team's Integrations page reads each app's integrations from it. Settings are
// edited on the apps' own pages, which save through their own routes; nothing saves here yet.

export type SettingValue = string | number | boolean | null;

/** Whether an integration is connected, for the dashboard's Integrations page. */
export type IntegrationStatus = {
  connected: boolean;
  /** A sentence more, when there's something to know: "The box has a key but isn't online." */
  detail?: string;
  /** What there is to know about the connection, a line each: a value, or a time (`at`, seconds). */
  facts?: IntegrationFact[];
};

export type IntegrationFact = { label: string; value?: string; at?: number };

/** What `GET /team-settings` answers. */
export type TeamSettingsState = {
  /** Every setting the form shows, by manifest key (secrets and integration settings left out). */
  values: Record<string, SettingValue>;
  /** Which of the app's secrets are set (never their values). */
  secretsSet: Record<string, boolean>;
  /** The integrations the app connects, and whether each is. */
  integrations: Partial<Record<AppIntegration, IntegrationStatus>>;
  /** The settings this user may change. */
  canEdit: string[];
};

export type TeamSettingsStore<E extends G3AuthEnv> = {
  /** The team's settings by manifest key; secrets as whether they're set. */
  read(c: Context<E>): Promise<{
    values: Record<string, SettingValue>;
    secretsSet?: Record<string, boolean>;
    integrations?: Partial<Record<AppIntegration, IntegrationStatus>>;
  }>;
  /**
   * Saves the settings that changed (already checked against their manifest types). Returns a
   * reason to refuse them, said to the admin, or nothing when they're saved.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: a save with nothing to refuse returns nothing
  save(c: Context<E>, changes: Record<string, SettingValue>): Promise<string | undefined | void>;
};

/** The settings a dashboard form shows: everything but an integration's connection. */
export const formSettings = (manifest: Pick<AppManifest, "settings">) =>
  manifest.settings.filter((s) => !s.integration);

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A value from a request, checked against its setting: the value, or why it isn't one. */
export function parseSettingValue(
  setting: AppSetting,
  value: unknown,
): { value: SettingValue } | { error: string } {
  const bad = (why: string) => ({ error: `${setting.label}: ${why}` });
  if (value === null || value === "") {
    if (setting.type === "boolean" || setting.type === "number" || setting.type === "bytes") {
      return bad("can't be empty.");
    }
    return { value: null };
  }
  switch (setting.type) {
    case "boolean":
      return typeof value === "boolean" ? { value } : bad("must be on or off.");
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return bad("must be a number.");
      if (setting.min !== undefined && value < setting.min) {
        return bad(`must be at least ${setting.min}.`);
      }
      if (setting.max !== undefined && value > setting.max) {
        return bad(`must be at most ${setting.max}.`);
      }
      return { value };
    }
    case "bytes":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? { value }
        : bad("must be a size of 0 or more.");
    case "month":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12
        ? { value: value as number }
        : bad("must be a month.");
    case "day of year": {
      const m = typeof value === "string" ? /^(\d{2})-(\d{2})$/.exec(value) : null;
      const month = m ? Number(m[1]) : 0;
      const day = m ? Number(m[2]) : 0;
      if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
        return bad("must be a month and day.");
      }
      return { value: value as string };
    }
    case "choice":
      return typeof value === "string" && setting.choices?.some((c) => c.value === value)
        ? { value }
        : bad("pick one of the choices.");
    case "url": {
      if (typeof value !== "string") return bad("must be a link.");
      try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:") return bad("must start with https://.");
        return { value: url.toString() };
      } catch {
        return bad("must be a link.");
      }
    }
    case "text":
    case "secret": {
      if (typeof value !== "string") return bad("must be text.");
      const text = value.trim();
      if (text.length > 500) return bad("is too long (500 characters at most).");
      return { value: text || null };
    }
  }
}

/** Whether this user may change a setting: its editors, never a kiosk session. */
const mayEdit = (c: Context<G3AuthEnv>, setting: AppSetting) =>
  c.get("sessionType") !== "pin" &&
  (setting.editedBy === "admin" ? c.get("userIsAdmin") : hasMentorAccess(c));

/**
 * `GET /` and `PUT /` for an app's team settings, mounted at `/team-settings`. Mentors and admins
 * read them; each setting is changed only by its `editedBy`. A `PUT` takes `{ values: { key:
 * value } }` with any of the form's settings, saves the ones that changed (`store.save`), logs
 * which (as `what`) and answers like `GET`.
 */
export function teamSettingsRoutes<E extends G3AuthEnv>(
  manifest: Pick<AppManifest, "settings" | "slug">,
  what: string,
  store: TeamSettingsStore<E>,
) {
  const auth = requireAuth as unknown as MiddlewareHandler<E>;
  const settings = formSettings(manifest);

  async function state(c: Context<E>): Promise<TeamSettingsState> {
    const read = await store.read(c);
    const values: Record<string, SettingValue> = {};
    for (const s of settings) {
      if (s.type !== "secret") values[s.key] = read.values[s.key] ?? s.default;
    }
    return {
      values,
      secretsSet: read.secretsSet ?? {},
      integrations: read.integrations ?? {},
      canEdit: settings
        .filter((s) => mayEdit(c as unknown as Context<G3AuthEnv>, s))
        .map((s) => s.key),
    };
  }

  const readers: MiddlewareHandler<E> = async (c, next) => {
    const g = c as unknown as Context<G3AuthEnv>;
    if (g.get("sessionType") === "pin" || !hasMentorAccess(g)) {
      return c.json({ error: "Mentor access required." }, 403);
    }
    await next();
  };

  // Hono narrows the handlers' context; it's the app's own.
  const own = (c: unknown) => c as Context<E>;

  return new Hono<E>()
    .get("/", auth, readers, async (c) => c.json(await state(own(c))))
    .put("/", auth, readers, async (c) => {
      const body = (await c.req.json().catch(() => null)) as { values?: unknown } | null;
      const input = body?.values;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return c.json({ error: "Send the settings to change." }, 400);
      }
      const before = await state(own(c));
      const changes: Record<string, SettingValue> = {};
      for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
        const setting = settings.find((s) => s.key === key);
        if (!setting) return c.json({ error: `There's no setting called ${key}.` }, 400);
        const parsed = parseSettingValue(setting, raw);
        if ("error" in parsed) return c.json({ error: parsed.error }, 400);
        const unchanged =
          setting.type === "secret"
            ? parsed.value === null && !before.secretsSet[key]
            : parsed.value === before.values[key];
        if (unchanged) continue;
        if (!mayEdit(c as unknown as Context<G3AuthEnv>, setting)) {
          return c.json(
            {
              error: `Only ${setting.editedBy === "admin" ? "admins" : "mentors"} can change ${setting.label}.`,
            },
            403,
          );
        }
        changes[key] = parsed.value;
      }
      if (Object.keys(changes).length > 0) {
        const refused = await store.save(own(c), changes);
        if (refused) return c.json({ error: refused }, 400);
        const g = c as unknown as Context<G3AuthEnv>;
        await logTeamChange(g.env, g.get("teamId"), {
          userId: g.get("userId"),
          app: manifest.slug,
          what,
          changed: settingLabels(manifest, Object.keys(changes)),
        });
      }
      return c.json(await state(own(c)));
    });
}
