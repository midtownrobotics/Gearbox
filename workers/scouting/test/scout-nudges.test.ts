import { env } from "cloudflare:workers";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import type { InactiveScout } from "../src/scout-nudges";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"] & { SCHEDULE: Fetcher };
type Overview = { available: boolean; chat?: string; onDuty?: number; scouts?: InactiveScout[] };

const HOUR = 3_600_000;

/** A team whose Schedule has its two students and its mentor on scouting duty now. */
async function onDutyTeam() {
  const team = teamUsers(newTeamId());
  const startsAt = Date.now() - HOUR / 2;
  const people = [team.student, team.otherStudent, team.mentor].map((user) => ({
    userId: user.id,
    displayName: user.displayName,
    roleName: "Scouting",
    startsAt,
    endsAt: startsAt + 2 * HOUR,
  }));
  await bindings.SCHEDULE.fetch(
    new Request(`http://schedule/test/teams/${team.teamId}/now`, {
      method: "PUT",
      body: JSON.stringify({ people }),
    }),
  );
  return { team, startsAt };
}

const heartbeat = (user: Parameters<typeof callAs>[0], page: string) =>
  jsonAs(user, "/scouting/presence", { method: "PUT", body: { page } });

describe("inactive scouts", () => {
  it("lists people on scouting duty who aren't scouting, for strategy leads", async () => {
    const { team, startsAt } = await onDutyTeam();
    await heartbeat(team.student, "playoffs");
    await heartbeat(team.mentor, "analysis");
    for (const user of [team.student, team.kioskAdmin])
      expect((await callAs(user, "/scouting/inactive-scouts")).status).toBe(403);
    const overview = await jsonAs<Overview>(team.admin, "/scouting/inactive-scouts");
    expect(overview).toMatchObject({ available: true, chat: "slack", onDuty: 3 });
    // The student is scouting playoffs; the other student never opened Scouting (away since the
    // shift started, chat not linked); the mentor is in the app on another page.
    expect(overview.scouts).toMatchObject([
      {
        userId: team.otherStudent.id,
        inactiveSince: startsAt,
        lastSeenAt: null,
        elsewhere: null,
        canNudge: false,
      },
      { userId: team.mentor.id, inactiveSince: null, elsewhere: "analysis", canNudge: true },
    ]);
  });

  it("nudges someone on duty once every few minutes, with the team's bot", async () => {
    const { team } = await onDutyTeam();
    await heartbeat(team.student, "forms");
    const nudge = (user: Parameters<typeof callAs>[0], who: string) =>
      callAs(user, `/scouting/inactive-scouts/${encodeURIComponent(who)}/nudge`, {
        method: "POST",
      });
    expect((await nudge(team.student, team.mentor.id)).status).toBe(403);
    // Scouting now, chat not linked, not on duty.
    expect((await nudge(team.admin, team.student.id)).status).toBe(409);
    expect((await nudge(team.admin, team.otherStudent.id)).status).toBe(409);
    expect((await nudge(team.admin, team.admin.id)).status).toBe(409);
    expect((await nudge(team.admin, team.mentor.id)).status).toBe(200);
    expect((await nudge(team.admin, team.mentor.id)).status).toBe(429);
    const sent = (await (
      await bindings.G3ID.fetch(
        new Request(`http://g3id/api/internal/teams/${team.teamId}/chat/dm-members`),
      )
    ).json()) as { userIds: string[]; text: string }[];
    expect(sent).toHaveLength(1);
    expect(sent[0].userIds).toEqual([team.mentor.id]);
    expect(sent[0].text).toContain("come scout");
    expect(sent[0].text).toContain("Scouting");
    const overview = await jsonAs<Overview>(team.admin, "/scouting/inactive-scouts");
    expect(overview.scouts?.find((s) => s.userId === team.mentor.id)?.nudgedAt).toBeGreaterThan(0);
  });

  it("isn't there for a team without a chat", async () => {
    const { team } = await onDutyTeam();
    await bindings.G3ID.fetch(
      new Request(`http://g3id/test/teams/${team.teamId}/chat`, {
        method: "PUT",
        body: JSON.stringify({ provider: null }),
      }),
    );
    expect(await jsonAs(team.admin, "/scouting/inactive-scouts")).toEqual({ available: false });
    expect(
      (
        await callAs(team.admin, `/scouting/inactive-scouts/${team.mentor.id}/nudge`, {
          method: "POST",
        })
      ).status,
    ).toBe(409);
  });

  it("says when nobody is on duty", async () => {
    const team = teamUsers(newTeamId());
    expect(await jsonAs(team.admin, "/scouting/inactive-scouts")).toMatchObject({
      available: true,
      onDuty: 0,
      scouts: [],
    });
  });
});
