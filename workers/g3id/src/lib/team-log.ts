import type { TeamChange } from "@g3/auth";
import type { TeamUiSettings } from "@g3/site-config";
import type { AppEnv } from "../types";

// The team's log (the platform's team_audit_log, read on the team's home's Apps page). G3ID writes
// its own big changes there (Team Appearance, Slack), and passes on other apps' (`logTeamChange`
// in @g3/auth, which they send to /internal/teams/:id/audit here).

/**
 * Adds a change to the team's log on the platform. Never throws: a change is never undone or
 * refused because its log line couldn't be written. False when it wasn't written.
 */
export async function logToTeam(
  env: AppEnv["Bindings"],
  teamId: string,
  change: TeamChange,
): Promise<boolean> {
  if (!env.PLATFORM) return false;
  try {
    const res = await env.PLATFORM.fetch(
      new Request(`http://platform/api/internal/teams/${encodeURIComponent(teamId)}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      }),
    );
    if (!res.ok) console.error("[audit] platform", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("[audit] platform", err);
    return false;
  }
}

/** Team Appearance's parts, as its log names them. */
const APPEARANCE_PARTS: Record<keyof TeamUiSettings, string> = {
  name: "Name",
  shortName: "Short name",
  logoUrl: "Logo",
  displayFont: "Display font",
  defaultTheme: "Default theme",
  linkAccents: "Linked accents",
  light: "Light colors",
  dark: "Dark colors",
  links: "Links",
  hiddenLinks: "Hidden links",
  appOrder: "Apps grid order",
};

/** The parts of Team Appearance a save changed, by name. */
export function appearanceChanges(before: TeamUiSettings, after: TeamUiSettings): string[] {
  return (Object.keys(APPEARANCE_PARTS) as (keyof TeamUiSettings)[])
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => APPEARANCE_PARTS[key]);
}
