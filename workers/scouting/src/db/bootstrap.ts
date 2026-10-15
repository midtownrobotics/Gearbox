import { inTeam, withTeam } from "@g3/auth";
import { teamKey } from "@g3/site-config";
import { type Db, batch, createDb } from "./index";
import {
  autoRoutines,
  boylebucksAccounts,
  boylebucksLedger,
  fieldMapPublishers,
  fieldMaps,
  gameBets,
  gameParlayLegs,
  gameParlays,
  manualEvents,
  manualMatches,
  manualScanCache,
  manualScanUsage,
  manualTeams,
  robotImages,
  robotTeams,
  scoutingEngagementSettings,
  scoutingFormSubmissions,
  scoutingForms,
  scoutingMatchAssignments,
  serviceHelpers,
  serviceTickets,
  strategyAdmins,
  strategyAnnouncements,
  strategyEventConfig,
  strategyPresence,
  teamComments,
  tierLists,
} from "./schema";

export const teamTables = [
  scoutingForms,
  robotTeams,
  manualEvents,
  gameParlays,
  autoRoutines,
  boylebucksAccounts,
  boylebucksLedger,
  fieldMapPublishers,
  fieldMaps,
  gameBets,
  gameParlayLegs,
  manualMatches,
  manualScanCache,
  manualScanUsage,
  manualTeams,
  robotImages,
  scoutingEngagementSettings,
  scoutingFormSubmissions,
  scoutingMatchAssignments,
  serviceHelpers,
  serviceTickets,
  strategyAdmins,
  strategyAnnouncements,
  strategyEventConfig,
  strategyPresence,
  teamComments,
  tierLists,
];
const adopted = new WeakMap<D1Database, Promise<void>>();
/** Only the configured original team owns pre-tenancy rows, regardless of the first visitor. */
export function adoptLegacyRows(d1: D1Database): Promise<void> {
  const pending = adopted.get(d1);
  if (pending) return pending;
  const db = createDb(d1);
  const task = batch(
    db,
    teamTables.map((table) =>
      db.update(table).set({ teamId: teamKey }).where(inTeam(table, "__legacy_scouting__")),
    ),
  )
    .then(() => undefined)
    .catch((error) => {
      adopted.delete(d1);
      throw error;
    });
  adopted.set(d1, task);
  return task;
}

/** Empty editable workflows for a new team; never copy another team's form definitions. */
export async function seedTeam(db: Db, teamId: string) {
  await db
    .insert(scoutingForms)
    .values(
      withTeam(teamId, [
        {
          id: "form_scouting",
          name: "Scouting",
          description: "",
          fields_json: "[]",
          form_kind: "scouting",
          is_active: 1,
          created_by: "system",
          created_at: 0,
          updated_at: 0,
        },
        {
          id: "form_pit_scouting",
          name: "Pit Scouting",
          description: "",
          fields_json: "[]",
          form_kind: "pit",
          is_active: 1,
          created_by: "system",
          created_at: 0,
          updated_at: 0,
        },
      ]),
    )
    .onConflictDoNothing()
    .run();
}
