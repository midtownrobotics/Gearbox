// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { site, teamKey } from "@g3/site-config";
import { type TestUser, admin, asUser, teamUsers } from "@g3/testing/users";
import { beforeAll, describe, expect, it } from "vitest";
import { retryMoves } from "../src/moves";
import type { AppEnv } from "../src/types";

// FRC and FTC teams (migration 0019): a team's id is its program and number, so FRC 254 and FTC
// 254 are two teams. A team from before FTC teams could sign up is asked once which program it's
// in; an FTC one moves to its "ftc" id in every app (src/moves.ts, the apps' move hooks are stubs
// in vitest.config.mts that say "not done" the first time), and its old id points the gateway at
// the new one until another team signs up with it.

const testEnv = env as unknown as AppEnv["Bindings"];

const newNumber = () => 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000);

function call(
  user: TestUser | null,
  path: string,
  init: { method?: string; body?: unknown; origin?: string } = {},
) {
  const { origin, ...rest } = init;
  const options = user ? asUser(user, rest) : { ...rest, body: undefined };
  const headers = new Headers(options.headers);
  if (origin) headers.set("Origin", origin);
  if (!user && rest.body !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(
    new Request(`http://platform/api${path}`, {
      ...options,
      headers,
      body: user ? options.body : rest.body === undefined ? undefined : JSON.stringify(rest.body),
    }),
  );
}

/** A team from before FTC teams could sign up: FRC, and it hasn't said which program it's in. */
async function oldTeam() {
  const number = newNumber();
  const id = `frc${number}`;
  await testEnv.PLATFORM_DB.prepare(
    `INSERT INTO teams (id, team_number, name, country, status, founder_user_id, owner_user_id,
       created_at, updated_at)
     VALUES (?1, ?2, 'An Old Team', 'US', 'active', 'u-founder', 'u-founder', 1, 1)`,
  )
    .bind(id, number)
    .run();
  await testEnv.PLATFORM_DB.prepare(
    "INSERT INTO team_apps (team_id, app, enabled, changed_at) VALUES (?1, 'orders', 1, 1)",
  )
    .bind(id)
    .run();
  return { id, number, users: teamUsers(id) };
}

const signup = (program: unknown, teamNumber: number) =>
  call(null, "/signup", {
    method: "POST",
    body: {
      program,
      teamNumber,
      name: "The Testers",
      country: "US",
      acceptTerms: true,
      acceptBeta: true,
    },
  });

const stubbedMoves = async (binding: "ORDERS" | "SHOP") =>
  (await (await testEnv[binding].fetch("http://app/api/internal/moved")).json()) as string[];

describe("signing up", () => {
  it("needs the team's program", async () => {
    const res = await signup(undefined, newNumber());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/FRC or FTC/);
  });

  it("lets an FRC team and an FTC team with the same number both sign up", async () => {
    const number = newNumber();
    expect((await signup("frc", number)).status).toBe(201);
    expect((await signup("ftc", number)).status).toBe(201);
    const ids = await testEnv.PLATFORM_DB.prepare(
      "SELECT id, program, program_chosen_at FROM teams WHERE team_number = ? ORDER BY id",
    )
      .bind(number)
      .all<{ id: string; program: string; program_chosen_at: number | null }>();
    expect(ids.results.map((r) => [r.id, r.program])).toEqual([
      [`frc${number}`, "frc"],
      [`ftc${number}`, "ftc"],
    ]);
    expect(ids.results.every((r) => r.program_chosen_at !== null)).toBe(true);
  });

  it("names the program when a number is taken", async () => {
    const team = await oldTeam();
    await testEnv.PLATFORM_DB.prepare(
      "INSERT INTO teams (id, program, team_number, name, country, status, created_at, updated_at) VALUES (?1, 'ftc', ?2, 'F', 'US', 'active', 1, 1)",
    )
      .bind(`ftc${team.number}`, team.number)
      .run();
    const res = await signup("ftc", team.number);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      `FTC Team ${team.number} is already on Gearbox.`,
    );
  });

  it("refuses the demo's number only for FRC", async () => {
    expect((await signup("frc", site.demo.teamNumber)).status).toBe(400);
    expect((await signup("ftc", site.demo.teamNumber)).status).toBe(201);
  });
});

describe("a team from before FTC teams", () => {
  it("is asked which program it's in, and the site's team isn't", async () => {
    const team = await oldTeam();
    const res = await call(team.users.student, "/team/program");
    expect(await res.json()).toMatchObject({ teamId: team.id, program: "frc", chosen: false });
    const site = await (await call(admin, "/team/program")).json();
    expect(site).toMatchObject({ teamId: teamKey, chosen: true });
  });

  it("stays where it is when it says FRC, and is asked no more", async () => {
    const team = await oldTeam();
    expect(
      (await call(team.users.student, "/team/program", { method: "PUT", body: { program: "frc" } }))
        .status,
    ).toBe(403);
    const res = await call(team.users.admin, "/team/program", {
      method: "PUT",
      body: { program: "frc" },
    });
    expect(await res.json()).toMatchObject({ teamId: team.id, moving: false });
    expect(await (await call(team.users.admin, "/team/program")).json()).toMatchObject({
      chosen: true,
    });
    // Once it's said, only an operator can change it.
    const again = await call(team.users.admin, "/team/program", {
      method: "PUT",
      body: { program: "ftc" },
    });
    expect(again.status).toBe(409);
  });

  it("moves to its FTC id in every app, then ID, then the platform, when it says FTC", async () => {
    const team = await oldTeam();
    const to = `ftc${team.number}`;
    const res = await call(team.users.admin, "/team/program", {
      method: "PUT",
      body: { program: "ftc" },
    });
    expect(await res.json()).toEqual({
      teamId: to,
      moving: false,
      home: `https://ftc${team.number}.${site.platformDomain}/`,
    });
    // Each app's hook was called until it said it was done (twice, in the stubs).
    expect((await stubbedMoves("ORDERS")).filter((m) => m === `${team.id}→${to}`)).toHaveLength(2);
    expect((await stubbedMoves("SHOP")).filter((m) => m === `${team.id}→${to}`)).toHaveLength(2);
    const g3id = await testEnv.G3ID.fetch(`http://g3id/api/internal/teams/${team.id}/move`);
    expect(await g3id.json()).toBe(to);

    // The platform's rows are the new id's.
    const rows = await testEnv.PLATFORM_DB.prepare(
      "SELECT id, program, program_chosen_at FROM teams WHERE team_number = ?",
    )
      .bind(team.number)
      .all<{ id: string; program: string; program_chosen_at: number | null }>();
    expect(rows.results).toEqual([
      { id: to, program: "ftc", program_chosen_at: expect.any(Number) },
    ]);
    const apps = await call(null, `/teams/${to}`);
    expect(await apps.json()).toMatchObject({ id: to, program: "ftc", moving: false });
    expect(
      ((await (await call(null, `/teams/${to}`)).json()) as { apps: string[] }).apps,
    ).toContain("orders");
    // The old id points at the new one.
    const old = await call(null, `/teams/${team.id}`);
    expect(old.status).toBe(404);
    expect(await old.json()).toMatchObject({ movedTo: to });
    // The team's log says so, under its new id.
    const log = await testEnv.PLATFORM_DB.prepare(
      "SELECT details FROM team_audit_log WHERE team_id = ? AND action = 'settings_changed'",
    )
      .bind(to)
      .first<{ details: string }>();
    expect(JSON.parse(log?.details ?? "{}")).toMatchObject({ what: "Program: FTC" });
  });

  it("stops pointing its old id at it once an FRC team signs up with the number", async () => {
    const team = await oldTeam();
    await call(team.users.admin, "/team/program", { method: "PUT", body: { program: "ftc" } });
    expect(await (await call(null, `/teams/${team.id}`)).json()).toMatchObject({
      movedTo: `ftc${team.number}`,
    });
    expect((await signup("frc", team.number)).status).toBe(201);
    // Still pending: the old id isn't a team yet, so it keeps pointing at the moved one.
    expect(await (await call(null, `/teams/${team.id}`)).json()).toMatchObject({
      movedTo: `ftc${team.number}`,
    });
    await testEnv.PLATFORM_DB.prepare("UPDATE teams SET status = 'active' WHERE id = ?")
      .bind(team.id)
      .run();
    const res = await call(null, `/teams/${team.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: team.id, program: "frc" });
  });

  it("says it's moving while an app can't finish, and the cron finishes it", async () => {
    const team = await oldTeam();
    await testEnv.SHOP.fetch(`http://app/api/internal/fail/${team.id}`, { method: "POST" });
    const res = await call(team.users.admin, "/team/program", {
      method: "PUT",
      body: { program: "ftc" },
    });
    expect(await res.json()).toMatchObject({ teamId: `ftc${team.number}`, moving: true });
    expect(await (await call(null, `/teams/${team.id}`)).json()).toMatchObject({
      id: team.id,
      moving: true,
    });
    const move = await testEnv.PLATFORM_DB.prepare(
      "SELECT attempts, last_error FROM team_moves WHERE from_id = ?",
    )
      .bind(team.id)
      .first<{ attempts: number; last_error: string }>();
    expect(move?.attempts).toBe(1);
    expect(move?.last_error).toMatch(/^Shop: 500/);

    // The app answers again; a run that started over 10 minutes ago is tried again.
    await testEnv.SHOP.fetch(`http://app/api/internal/unfail/${team.id}`, { method: "POST" });
    await testEnv.PLATFORM_DB.prepare("UPDATE team_moves SET started_at = 1 WHERE from_id = ?")
      .bind(team.id)
      .run();
    await retryMoves(testEnv);
    expect(await (await call(null, `/teams/${team.id}`)).json()).toMatchObject({
      movedTo: `ftc${team.number}`,
    });
  });
});

describe("the operators' console", () => {
  beforeAll(async () => {
    await testEnv.PLATFORM_DB.prepare(
      "INSERT OR IGNORE INTO operators (user_id, created_at) VALUES (?, 1)",
    )
      .bind(admin.id)
      .run();
  });
  const CONSOLE = `https://admin.${site.platformDomain}`;
  const consoleCall = (path: string, body: unknown) =>
    call(admin, `/console${path}`, { method: "POST", body, origin: CONSOLE });

  it("changes a team's program, moving it, with a reason", async () => {
    const team = await oldTeam();
    expect((await consoleCall(`/teams/${team.id}/program`, { program: "ftc" })).status).toBe(400);
    const res = await consoleCall(`/teams/${team.id}/program`, {
      program: "ftc",
      reason: "The team wrote in: it's an FTC team.",
    });
    expect(await res.json()).toEqual({ teamId: `ftc${team.number}`, moving: false });
    const logged = await testEnv.PLATFORM_DB.prepare(
      "SELECT team_id FROM operator_actions WHERE action = 'change_program' AND reason = ?",
    )
      .bind("The team wrote in: it's an FTC team.")
      .first<{ team_id: string }>();
    // Logged under the old id, then moved with the team's other rows.
    expect(logged?.team_id).toBe(`ftc${team.number}`);
    // And back again.
    const back = await consoleCall(`/teams/ftc${team.number}/program`, {
      program: "frc",
      reason: "Wrong after all.",
    });
    expect(await back.json()).toEqual({ teamId: team.id, moving: false });
    expect((await call(null, `/teams/${team.id}`)).status).toBe(200);
    expect(await (await call(null, `/teams/ftc${team.number}`)).json()).toMatchObject({
      movedTo: team.id,
    });
  });

  it("won't move the site's team", async () => {
    const res = await consoleCall(`/teams/${teamKey}/program`, { program: "ftc", reason: "No." });
    expect(res.status).toBe(409);
  });
});
