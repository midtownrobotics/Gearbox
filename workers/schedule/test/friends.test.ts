import { admin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Friends are private: each person sees only their own list, a friend is never told, and the
// team's data download leaves them out.

type Friend = { userId: string; displayName: string };

describe("friends", () => {
  it("are each person's own, and never shown to the friend or anyone else", async () => {
    await jsonAs(student, `/friends/${otherStudent.id}`, { method: "PUT" });
    // Adding twice is fine.
    await jsonAs(student, `/friends/${otherStudent.id}`, { method: "PUT" });
    expect(await jsonAs<Friend[]>(student, "/friends")).toEqual([
      { userId: otherStudent.id, displayName: otherStudent.displayName },
    ]);
    // Not to the friend, and not to mentors or admins either.
    for (const user of [otherStudent, mentor, admin]) {
      expect((await jsonAs<Friend[]>(user, "/friends")).some((f) => f.userId === student.id)).toBe(
        false,
      );
    }

    await jsonAs(student, `/friends/${otherStudent.id}`, { method: "DELETE" });
    expect(await jsonAs<Friend[]>(student, "/friends")).toEqual([]);
  });

  it("can be anyone else on the team, but not yourself or someone who isn't", async () => {
    const self = await callAs(student, `/friends/${student.id}`, { method: "PUT" });
    expect(self.status).toBe(400);
    const stranger = await callAs(student, "/friends/someone-else", { method: "PUT" });
    expect(stranger.status).toBe(400);

    const people = await jsonAs<{ id: string; displayName: string }[]>(student, "/friends/people");
    expect(people.map((p) => p.id)).not.toContain(student.id);
    expect(people.map((p) => p.id)).toContain(mentor.id);
    // Names only.
    expect(Object.keys(people[0]).sort()).toEqual(["displayName", "id"]);
  });

  it("are left out of the team's data download", async () => {
    await jsonAs(mentor, `/friends/${student.id}`, { method: "PUT" });
    const exported = (await (await call(`/internal/teams/${student.teamId}/export`)).json()) as {
      tables: Record<string, unknown>;
      notes?: string[];
    };
    expect(exported.tables).not.toHaveProperty("friends");
    expect(exported.notes?.join(" ")).toMatch(/friends/);
  });
});
