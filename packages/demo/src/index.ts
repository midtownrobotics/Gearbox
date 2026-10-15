import { demoTeamId, site, teamUiDefaults } from "@g3/site-config";
import { collectWords } from "./guard.ts";
import { DEMO_PEOPLE } from "./people.ts";
import { SAFE_TEXT } from "./safe-text.ts";

// The public demo (roadmap Phase 5): team site.demo.teamNumber, with no sign-in, sample data
// reloaded every night at midnight in site.demo.timeZone, and only safe text from visitors.

export { demoTeamId, isDemoTeam } from "@g3/site-config";
export * from "./guard.ts";
export * from "./people.ts";
export * from "./safe-text.ts";
export * from "./time.ts";

/** Every time zone's name (Schedule and the apps' settings send them), where the runtime lists them. */
function timeZones(): string[] {
  const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
  return [site.demo.timeZone, ...(intl.supportedValuesOf?.("timeZone") ?? [])];
}

/**
 * The words the demo has before any app's sample data: the safe lists, the members' names, the
 * team's default appearance (its name, links, fonts) and time zones. Each app adds its sample
 * data's words (its `GET /internal/demo/words`).
 */
export function baseVocabulary(): Set<string> {
  return collectWords([
    SAFE_TEXT,
    DEMO_PEOPLE,
    teamUiDefaults(demoTeamId, site.demo.name),
    ["Gearbox demo sample", "Agency FB", "Ubuntu", "system-ui"],
    timeZones(),
  ]);
}

/** Every word in a set of sample data, as an app's `GET /internal/demo/words` answers it. */
export function vocabularyOf(...data: unknown[]): string[] {
  return [...collectWords(data)].sort();
}
