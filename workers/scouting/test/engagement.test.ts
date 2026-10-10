import { env } from "cloudflare:workers";
import { teamKey } from "@g3/site-config";
import { admin, kioskAdmin, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { beforeEach, describe, expect, it } from "vitest";
import { type EngagementSettings, defaultEngagementSettings } from "../src/engagement";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
const db = bindings.SCOUTING_DB;
const path = "/scouting/engagement-settings";
const save = (changes: Partial<EngagementSettings> = {}) =>
  jsonAs<EngagementSettings>(admin, path, {
    method: "PUT",
    body: { ...defaultEngagementSettings, ...changes },
  });

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM scouting_engagement_settings"),
    db.prepare("DELETE FROM strategy_event_config"),
    db.prepare("DELETE FROM strategy_admins"),
    db.prepare("DELETE FROM boylebucks_accounts"),
  ]);
});

describe("optional engagement", () => {
  it("is off by default and rejects direct game requests before creating accounts", async () => {
    expect((await call(path)).status).toBe(401);
    expect(await jsonAs(student, path)).toEqual(defaultEngagementSettings);
    expect(await jsonAs(student, "/scouting/me")).toMatchObject({
      engagement: defaultEngagementSettings,
    });
    for (const [method, route] of [
      ["GET", "/game"],
      ["POST", "/game/bets"],
      ["POST", "/game/parlays"],
    ]) {
      expect(
        (
          await callAs(student, `/scouting${route}`, {
            method,
            body: method === "GET" ? undefined : {},
          })
        ).status,
      ).toBe(403);
    }
    expect(
      await db
        .prepare("SELECT * FROM boylebucks_accounts WHERE user_id = ?")
        .bind(student.id)
        .first(),
    ).toBeNull();
    const pending: Promise<unknown>[] = [];
    const disabledBindings = {
      SCOUTING_DB: {
        prepare: (sql: string) => {
          if (sql.includes("strategy_event_config"))
            throw new Error("Disabled cron must not query events");
          return db.prepare(sql);
        },
      },
    } as unknown as AppEnv["Bindings"];
    worker.scheduled({} as ScheduledController, disabledBindings, {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
    } as unknown as ExecutionContext);
    await Promise.all(pending);
  });

  it("restricts changes to identity admins, including when a student is a strategy lead", async () => {
    await db
      .prepare(
        "INSERT INTO strategy_admins (user_id, email, display_name, granted_by, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(student.id, student.email, student.displayName, admin.id, Date.now())
      .run();
    for (const user of [student, kioskAdmin]) {
      expect(
        (
          await callAs(user, path, {
            method: "PUT",
            body: { ...defaultEngagementSettings, enabled: true },
          })
        ).status,
      ).toBe(403);
    }
    const settings = await save({ enabled: true, pointsLabel: "  Team Points  " });
    expect(settings.pointsLabel).toBe("Team Points");
    expect(await jsonAs(student, path)).toEqual(settings);
    expect(
      await db.prepare("SELECT team_key, updated_by FROM scouting_engagement_settings").first(),
    ).toEqual({ team_key: teamKey, updated_by: admin.id });
  });

  it("rejects invalid names, malformed JSON, and non-boolean switches without changing settings", async () => {
    for (const changes of [
      { pointsLabel: " " },
      { pointsLabel: "x".repeat(41) },
      { pointsLabel: "bad\u0000name" },
      { enabled: "false" },
    ]) {
      expect(
        (
          await callAs(admin, path, {
            method: "PUT",
            body: { ...defaultEngagementSettings, ...changes },
          })
        ).status,
      ).toBe(400);
    }
    expect((await callAs(admin, path, { method: "PUT", body: "{" })).status).toBe(400);
    expect(await jsonAs(student, path)).toEqual(defaultEngagementSettings);
  });

  it("supports points without predictions and does not expose teammates when standings are disabled", async () => {
    await save({ enabled: true, predictionsEnabled: false });
    await db
      .prepare(
        "INSERT OR REPLACE INTO boylebucks_accounts (user_id, display_name, balance, earned, wagered, updated_at) VALUES (?, ?, 75, 75, 0, ?)",
      )
      .bind(student.id, student.displayName, Date.now())
      .run();
    await db
      .prepare(
        "INSERT INTO boylebucks_accounts (user_id, display_name, balance, earned, wagered, updated_at) VALUES (?, ?, 25, 25, 0, ?)",
      )
      .bind(otherStudent.id, otherStudent.displayName, Date.now())
      .run();
    const game = await jsonAs<{
      account: { balance: number };
      leaderboard: unknown[];
      matches: unknown[];
      bets: unknown[];
      parlays: unknown[];
    }>(student, "/scouting/game");
    expect(game).toMatchObject({
      account: { balance: 75 },
      leaderboard: [],
      matches: [],
      bets: [],
      parlays: [],
    });
    expect(
      (await callAs(student, "/scouting/game/bets", { method: "POST", body: {} })).status,
    ).toBe(403);
    expect(
      (await callAs(student, "/scouting/game/parlays", { method: "POST", body: {} })).status,
    ).toBe(403);
    await save({ enabled: true, predictionsEnabled: false, leaderboardEnabled: true });
    expect(await jsonAs(student, "/scouting/game")).toMatchObject({
      leaderboard: expect.arrayContaining([
        expect.objectContaining({ display_name: student.displayName, balance: 75 }),
        expect.objectContaining({ display_name: otherStudent.displayName, balance: 25 }),
      ]),
    });
    await save();
    expect((await callAs(student, "/scouting/game")).status).toBe(403);
    expect(
      await db
        .prepare("SELECT balance FROM boylebucks_accounts WHERE user_id = ?")
        .bind(student.id)
        .first(),
    ).toEqual({ balance: 75 });
  });

  it("gates combined picks independently of single-match predictions", async () => {
    await save({ enabled: true });
    expect(
      (await callAs(student, "/scouting/game/bets", { method: "POST", body: {} })).status,
    ).toBe(400);
    expect(
      (await callAs(student, "/scouting/game/parlays", { method: "POST", body: {} })).status,
    ).toBe(403);
    await save({ enabled: true, combinationsEnabled: true });
    expect(
      (await callAs(student, "/scouting/game/parlays", { method: "POST", body: {} })).status,
    ).toBe(400);
  });

  it("continues saving scouting reports while disabled, awards points only when enabled, and prevents repeat awards", async () => {
    const eventKey = `manual-${crypto.randomUUID()}`;
    const { id } = await jsonAs<{ id: string }>(
      admin,
      "/scouting/scouting-forms",
      {
        method: "POST",
        body: { name: "Points test", fields: [{ id: "auto", label: "Auto", type: "counter" }] },
      },
      201,
    );
    await db
      .prepare(
        "INSERT INTO strategy_event_config (id, event_key, current_match_number, updated_by, updated_at, schedule_mode) VALUES (1, ?, 1, ?, ?, 'manual')",
      )
      .bind(eventKey, admin.id, Date.now())
      .run();
    const submit = async (match: number) => {
      await db
        .prepare("UPDATE strategy_event_config SET current_match_number = ? WHERE id = 1")
        .bind(match)
        .run();
      await db
        .prepare(
          "INSERT OR IGNORE INTO scouting_match_assignments (event_key, match_number, user_id, team_number, assigned_at) VALUES (?, ?, ?, '9999', ?)",
        )
        .bind(eventKey, match, student.id, Date.now())
        .run();
      const body = new FormData();
      body.set("answers", JSON.stringify({ auto: 5 }));
      return callAs(student, `/scouting/scouting-forms/${id}/submissions`, {
        method: "POST",
        body,
      });
    };
    let response = await submit(1);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ boyleBucksAwarded: 0 });
    const before = await db
      .prepare("SELECT balance FROM boylebucks_accounts WHERE user_id = ?")
      .bind(student.id)
      .first<{ balance: number }>();
    await save({ enabled: true, predictionsEnabled: false });
    response = await submit(2);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ boyleBucksAwarded: 10 });
    expect((await submit(2)).status).toBe(409);
    expect(
      await db
        .prepare("SELECT balance FROM boylebucks_accounts WHERE user_id = ?")
        .bind(student.id)
        .first(),
    ).toEqual({ balance: (before?.balance ?? 0) + 10 });
    await save();
    response = await submit(3);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ boyleBucksAwarded: 0 });
    expect(
      await db
        .prepare("SELECT balance FROM boylebucks_accounts WHERE user_id = ?")
        .bind(student.id)
        .first(),
    ).toEqual({ balance: (before?.balance ?? 0) + 10 });
  });
});
