import { activeMembers } from "@g3/auth";
import type { Context } from "hono";
import type { AppEnv } from "../types";

// Who the students are. Skill Tree keeps no list of people: the students are the team's active
// members (from G3ID, with their roles), less its mentors. Admins who aren't mentors are students.

export type Student = { userId: string; name: string };

export const ROSTER_UNAVAILABLE = "Couldn't load the list of members.";

/** The team's students, by name. Null when G3ID can't be reached. */
export async function loadStudents(c: Context<AppEnv>): Promise<Student[] | null> {
  const members = await activeMembers(c.env, c.get("teamId"));
  if (!members) return null;
  return members
    .filter((m) => !m.isMentor && m.displayName.trim().toLowerCase() !== "admin")
    .map((m) => ({ userId: m.id, name: m.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
