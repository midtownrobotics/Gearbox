import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Context } from "hono";
import type { Db } from "../db";
import { mentors } from "../db/schema";
import type { AppEnv } from "../types";
import { chunks } from "./input";

// Who the students are. Skill Tree keeps no list of people: the students are G3ID's active
// accounts, less its mentors.
//
// G3ID's list of accounts doesn't say who is a mentor (it tells an app that only about the person
// signed in), so Skill Tree remembers what sign-ins tell it: a mentor is known once they open
// Skill Tree, and every mentor is known once a G3ID admin does (admins can read everyone's roles).
// When G3ID's list carries roles, `loadStudents` is the one place to change and the `mentors`
// table can go.

export type Student = { userId: string; name: string };

export const ROSTER_UNAVAILABLE = "Couldn't load the list of members.";

const fromG3id = (c: Context<AppEnv>, path: string) =>
  c.env.G3ID.fetch(
    new Request(`http://g3id/api${path}`, { headers: { cookie: c.req.header("Cookie") ?? "" } }),
  );

/** The students, by name. Null when G3ID can't be reached. */
export async function loadStudents(c: Context<AppEnv>, db: Db): Promise<Student[] | null> {
  const [res, known] = await Promise.all([
    fromG3id(c, "/users/attendance-eligible"),
    db.select({ userId: mentors.userId }).from(mentors).all(),
  ]);
  if (!res.ok) return null;
  const { users } = (await res.json()) as { users: { id: string; displayName: string }[] };
  const mentorIds = new Set(known.map((row) => row.userId));
  return users
    .filter((user) => !mentorIds.has(user.id))
    .map((user) => ({ userId: user.id, name: user.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everyone's roles, as G3ID's admin list has them. Null unless the person signed in is an admin. */
async function allMentorIds(c: Context<AppEnv>): Promise<string[] | null> {
  const res = await fromG3id(c, "/admin/users");
  if (!res.ok) return null;
  const users = (await res.json()) as { id?: unknown; isMentor?: unknown }[];
  if (!Array.isArray(users)) return null;
  return users
    .filter(
      (user) => typeof user.id === "string" && (user.isMentor === 1 || user.isMentor === true),
    )
    .map((user) => user.id as string);
}

/**
 * Takes in what this sign-in says about who is a mentor. A kiosk PIN session says nothing: G3ID
 * reports no roles for those.
 */
export async function noteSignIn(c: Context<AppEnv>, db: Db): Promise<void> {
  if (c.get("sessionType") === "pin") return;
  const userId = c.get("userId");

  const everyone = c.get("userIsAdmin") ? await allMentorIds(c) : null;
  if (everyone) {
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [db.delete(mentors)];
    for (const chunk of chunks(everyone, 50)) {
      statements.push(db.insert(mentors).values(chunk.map((id) => ({ userId: id }))));
    }
    await db.batch(statements);
    return;
  }

  if (c.get("userIsMentor")) {
    await db.insert(mentors).values({ userId }).onConflictDoNothing();
  } else {
    await db.delete(mentors).where(eq(mentors.userId, userId));
  }
}
