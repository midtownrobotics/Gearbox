import { withTeam } from "@g3/auth";
import { createDb } from "../src/db";
import { manualEvents, manualMatches } from "../src/db/schema";

export async function seedManualMatch(
  database: D1Database,
  teamId: string,
  eventKey: string,
  matchNumber: number,
  createdBy: string,
) {
  const db = createDb(database);
  await db
    .insert(manualEvents)
    .values(
      withTeam(teamId, {
        event_key: eventKey,
        event_name: "Test Invitational",
        ends_at: Date.now() + 86400000,
        delete_after: Date.now() + 172800000,
        created_by: createdBy,
        updated_at: Date.now(),
      }),
    )
    .onConflictDoNothing();
  const matchKey = `${eventKey}_qm${matchNumber}`;
  await db
    .insert(manualMatches)
    .values(
      withTeam(teamId, {
        event_key: eventKey,
        match_key: matchKey,
        match_number: matchNumber,
        red_1: "9999",
        red_2: "102",
        red_3: "103",
        blue_1: "104",
        blue_2: "105",
        blue_3: "106",
      }),
    )
    .onConflictDoNothing();
  return matchKey;
}
