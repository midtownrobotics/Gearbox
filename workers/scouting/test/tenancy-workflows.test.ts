import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { asUser, newTeamId, teamUsers, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import {
  boylebucksAccounts,
  gameBets,
  gameParlayLegs,
  gameParlays,
  manualScanUsage,
  strategyEventConfig,
} from "../src/db/schema";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
const db = createDb(bindings.SCOUTING_DB);

async function gameTeam(eventKey = "upcoming-event", balance = 100) {
  const team = teamUsers(newTeamId());
  // Repeated user ids are intentional: ownership must never depend on a globally unique person.
  const scout = testUser({ id: "shared-scout", teamId: team.teamId });
  await jsonAs(team.admin, "/scouting/engagement-settings", {
    method: "PUT",
    body: {
      enabled: true,
      predictionsEnabled: true,
      combinationsEnabled: true,
      leaderboardEnabled: true,
      pointsLabel: "Test Points",
    },
  });
  await db.insert(strategyEventConfig).values(
    withTeam(team.teamId, {
      id: 1,
      event_key: eventKey,
      updated_by: team.admin.id,
      updated_at: Date.now(),
    }),
  );
  await db.insert(boylebucksAccounts).values(
    withTeam(team.teamId, {
      user_id: scout.id,
      display_name: scout.displayName,
      balance,
      earned: balance,
      wagered: 0,
      updated_at: Date.now(),
    }),
  );
  return { ...team, scout };
}
const pick = (match: number, stake = 10) => ({
  matchKey: `shared-qm${match}`,
  market: "spread",
  selection: "red",
  expectedLine: -10,
  stake,
});

describe("team-scoped workflows", () => {
  it("uploads reports, field maps and autos to private team paths and rejects forged image IDs", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    const forms = await jsonAs<{ forms: { id: string; kind: string }[] }>(
      a.student,
      "/scouting/scouting-forms",
    );
    const pitId = forms.forms.find((form) => form.kind === "pit")?.id;
    const body = new FormData();
    body.set("teamName", "123");
    body.set("answers", "{}");
    body.set("drawing", new File([`private-${a.teamId}`], "drawing.png", { type: "image/png" }));
    const submission = await jsonAs<{ id: string }>(
      a.student,
      `/scouting/scouting-forms/${pitId}/submissions`,
      { method: "POST", body },
      201,
    );
    const drawing = `/scouting/scouting-submissions/${submission.id}/drawing`;
    expect((await callAs(a.admin, drawing)).status).toBe(200);
    expect((await callAs(b.admin, drawing)).status).toBe(404);
    for (const route of ["field-maps", "autos"]) {
      const form = new FormData();
      form.set("name", `private-${a.teamId}`);
      form.set("image", new File([`private-${a.teamId}`], "image.png", { type: "image/png" }));
      const { id } = await jsonAs<{ id: string }>(
        a.admin,
        `/scouting/${route}`,
        { method: "POST", body: form },
        201,
      );
      expect((await callAs(b.admin, `/scouting/${route}/${id}/image`)).status).toBe(404);
      await callAs(b.admin, `/scouting/${route}/${id}`, { method: "DELETE" });
      expect((await callAs(a.admin, `/scouting/${route}/${id}/image`)).status).toBe(200);
    }
    const objects = await bindings.FIELD_MAPS.list({ prefix: `teams/${a.teamId}/` });
    expect(objects.objects).toHaveLength(3);
  });

  it("grants roles only to the team's members and routes alerts through its own chat", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    for (const route of ["strategy-admins", "service-helpers", "field-map-publishers"]) {
      expect(
        (
          await callAs(a.admin, `/scouting/${route}`, {
            method: "POST",
            body: { userId: b.student.id, skills: [] },
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await callAs(a.admin, "/scouting/service-helpers", {
          method: "POST",
          body: { userId: a.student.id, skills: ["mechanical"] },
        })
      ).status,
    ).toBe(201);
    expect(await jsonAs(a.student, "/scouting/me")).toMatchObject({ isHelper: true });
    expect(await jsonAs(b.student, "/scouting/me")).toMatchObject({ isHelper: false });
    expect(
      (
        await callAs(a.student, "/scouting/service-tickets", {
          method: "POST",
          body: { teamName: "123", issueTypes: ["mechanical"], description: "Repair wheel" },
        })
      ).status,
    ).toBe(201);
    const messages = async (teamId: string) =>
      (
        await bindings.G3ID.fetch(
          new Request(`http://g3id/api/internal/teams/${teamId}/chat/dm-members`),
        )
      ).json();
    expect(await messages(a.teamId)).toEqual([
      expect.objectContaining({
        userIds: [a.student.id],
        text: expect.stringContaining("Repair wheel"),
      }),
    ]);
    expect(await messages(b.teamId)).toEqual([]);
  });

  it("allows the same match and user ids in different teams without sharing balances or picks", async () => {
    const a = await gameTeam();
    const b = await gameTeam();
    expect(
      (await callAs(a.scout, "/scouting/game/bets", { method: "POST", body: pick(1, 20) })).status,
    ).toBe(201);
    expect(
      (await callAs(b.scout, "/scouting/game/bets", { method: "POST", body: pick(1, 30) })).status,
    ).toBe(201);
    expect(await jsonAs(a.scout, "/scouting/game")).toMatchObject({
      account: { balance: 80, wagered: 20 },
      bets: [expect.objectContaining({ stake: 20 })],
    });
    expect(await jsonAs(b.scout, "/scouting/game")).toMatchObject({
      account: { balance: 70, wagered: 30 },
      bets: [expect.objectContaining({ stake: 30 })],
    });
  });

  it("preserves atomic funds checks for concurrent picks and cannot borrow another team's balance", async () => {
    const a = await gameTeam();
    const b = await gameTeam("upcoming-event", 0);
    const responses = await Promise.all(
      [1, 2].map((match) =>
        callAs(a.scout, "/scouting/game/bets", { method: "POST", body: pick(match, 75) }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await jsonAs(a.scout, "/scouting/game")).toMatchObject({
      account: { balance: 25, wagered: 75 },
    });
    await expect(
      db.insert(gameBets).values(
        withTeam(b.teamId, {
          id: crypto.randomUUID(),
          user_id: b.scout.id,
          user_name: b.scout.displayName,
          event_key: "upcoming-event",
          match_key: "shared-qm1",
          match_label: "Qualification 1",
          market: "spread",
          selection: "red",
          line: -10,
          odds: -110,
          stake: 10,
          placed_at: Date.now(),
        }),
      ),
    ).rejects.toThrow();
    expect(await jsonAs(b.scout, "/scouting/game")).toMatchObject({
      account: { balance: 0, wagered: 0 },
      bets: [],
    });
  });

  it("submits combined picks and keeps their legs in the owning team", async () => {
    const a = await gameTeam();
    const b = await gameTeam();
    expect(
      (
        await callAs(a.scout, "/scouting/game/parlays", {
          method: "POST",
          body: { legs: [pick(1), pick(2)], stake: 15 },
        })
      ).status,
    ).toBe(201);
    const result = await jsonAs<{ account: { balance: number }; parlays: { legs: unknown[] }[] }>(
      a.scout,
      "/scouting/game",
    );
    expect(result.account.balance).toBe(85);
    expect(result.parlays[0].legs).toHaveLength(2);
    expect(await jsonAs(b.scout, "/scouting/game")).toMatchObject({
      account: { balance: 100 },
      parlays: [],
    });
  });

  it("settles each team's picks once even when teams share an event and user id", async () => {
    const a = await gameTeam("finished-event");
    const b = await gameTeam("finished-event");
    const disabled = await gameTeam("finished-event");
    await jsonAs(disabled.admin, "/scouting/engagement-settings", {
      method: "PUT",
      body: {
        enabled: false,
        predictionsEnabled: true,
        combinationsEnabled: true,
        leaderboardEnabled: true,
        pointsLabel: "Test Points",
      },
    });
    for (const [team, stake] of [
      [a, 10],
      [b, 20],
      [disabled, 30],
    ] as const) {
      await db.insert(gameBets).values(
        withTeam(team.teamId, {
          id: crypto.randomUUID(),
          user_id: team.scout.id,
          user_name: team.scout.displayName,
          event_key: "finished-event",
          match_key: "shared-qm1",
          match_label: "Qualification 1",
          market: "spread",
          selection: "red",
          line: -10,
          odds: -110,
          stake,
          placed_at: Date.now(),
        }),
      );
      const parlayId = crypto.randomUUID();
      await db.insert(gameParlays).values(
        withTeam(team.teamId, {
          id: parlayId,
          user_id: team.scout.id,
          user_name: team.scout.displayName,
          event_key: "finished-event",
          odds: 264,
          stake,
          placed_at: Date.now(),
        }),
      );
      await db.insert(gameParlayLegs).values(
        withTeam(
          team.teamId,
          [1, 2].map((match) => ({
            id: crypto.randomUUID(),
            parlay_id: parlayId,
            match_key: `shared-qm${match}`,
            match_label: `Qualification ${match}`,
            market: "spread",
            selection: "red",
            line: -10,
            odds: -110,
          })),
        ),
      );
    }
    const run = async () => {
      const pending: Promise<unknown>[] = [];
      worker.scheduled({} as ScheduledController, bindings, {
        waitUntil: (task: Promise<unknown>) => pending.push(task),
      } as unknown as ExecutionContext);
      await Promise.all(pending);
    };
    await run();
    const balance = async (teamId: string) =>
      (
        await db
          .select()
          .from(boylebucksAccounts)
          .where(inTeam(boylebucksAccounts, teamId, eq(boylebucksAccounts.user_id, "shared-scout")))
          .get()
      )?.balance;
    const first = [
      await balance(a.teamId),
      await balance(b.teamId),
      await balance(disabled.teamId),
    ];
    expect(first).toEqual([155, 210, 100]);
    await run();
    expect([
      await balance(a.teamId),
      await balance(b.teamId),
      await balance(disabled.teamId),
    ]).toEqual(first);
  });

  it("isolates identical OCR uploads, their cached results and per-team scan quotas", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    let calls = 0;
    const scan = async (team: typeof a, contents = "same image") => {
      const form = new FormData();
      form.set("files", new File([contents], "schedule.png", { type: "image/png" }));
      return worker.fetch(
        new Request(
          "http://worker.test/scouting/manual-schedule/extract",
          asUser(team.admin, { method: "POST", body: form }),
        ),
        {
          ...bindings,
          AI: {
            run: async () => {
              calls++;
              return {
                response: JSON.stringify({
                  matches: [{ matchNumber: 1, teams: [123, 456, 789, 111, 222, 333] }],
                  teams: { 123: `private-${team.teamId}` },
                }),
              };
            },
          } as unknown as Ai,
        },
        {} as ExecutionContext,
      );
    };
    expect((await scan(a)).status).toBe(200);
    const bResult = await scan(b);
    expect(bResult.status).toBe(200);
    expect(await bResult.text()).not.toContain(`private-${a.teamId}`);
    expect(calls).toBe(2);
    expect((await scan(a)).status).toBe(200);
    expect(calls).toBe(2);
    await db
      .update(manualScanUsage)
      .set({ page_count: 12 })
      .where(inTeam(manualScanUsage, b.teamId));
    expect((await scan(b, "another image")).status).toBe(422);
    expect((await scan(a, "another image")).status).toBe(200);
    expect(calls).toBe(3);
  });
});
