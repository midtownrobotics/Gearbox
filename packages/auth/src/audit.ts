// The team's log (the platform's `team_audit_log`, which the team's admins read on its home's
// Apps page): who changed a big setting, and which. An app writes to it through G3ID, which it
// already reaches (G3ID passes it on to the platform), so no app needs a binding of its own.

export type TeamChange = {
  /** Who made it (a G3ID account), or null for something the app did on its own. */
  userId: string | null;
  /** The app's slug (site.ts), or "id" for the team's own settings in G3ID. */
  app: string;
  /** What was changed, in a few words: "Team appearance", "Fiscal year". */
  what: string;
  /** The names of the fields that changed (never their values: some are secrets). */
  changed?: string[];
};

/**
 * Adds a change to the team's log. Never throws and never fails the change it records: a log
 * that can't be written is reported in the worker's logs.
 */
export async function logTeamChange(env: { G3ID: Fetcher }, teamId: string, change: TeamChange) {
  try {
    const res = await env.G3ID.fetch(
      new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      }),
    );
    if (!res.ok)
      console.error("[audit] team log failed", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("[audit] team log failed", err);
  }
}

/** The fields whose values differ between two settings objects (for `changed`). */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  return Object.keys(after).filter(
    (key) => after[key] !== undefined && JSON.stringify(after[key]) !== JSON.stringify(before[key]),
  );
}

/** Setting keys as the app's manifest labels them, for the log ("Currency", not "currency"). */
export function settingLabels(
  manifest: { settings: { key: string; label: string }[] },
  keys: string[],
): string[] {
  return keys.map((key) => manifest.settings.find((s) => s.key === key)?.label ?? key);
}
