import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { site, teamKey } from "@g3/site-config";
import { type TestUser, admin, asUser, kioskAdmin, student } from "@g3/testing/users";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";

// The operators' console (roadmap 2.8). G3ID is stubbed in vitest.config.mts: every team has a
// founder ("u-founder") and a member ("u-member").

const testEnv = env as unknown as AppEnv["Bindings"];
const CONSOLE = `https://admin.${site.platformDomain}`;

/** `admin` is an operator here; `student` isn't. */
const operator = admin;

function call(
  user: TestUser | null,
  path: string,
  init: { method?: string; body?: unknown; origin?: string | null } = {},
) {
  const { origin = CONSOLE, ...rest } = init;
  const options = user ? asUser(user, rest) : { ...rest, body: undefined };
  const headers = new Headers(options.headers);
  if (origin) headers.set("Origin", origin);
  return exports.default.fetch(
    new Request(`http://platform/api/console${path}`, { ...options, headers }),
  );
}

const newNumber = () => 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000);

/** An active team, as sign-up leaves one. */
async function createTeam(status = "active"): Promise<{ id: string; number: number }> {
  const number = newNumber();
  await testEnv.PLATFORM_DB.prepare(
    `INSERT INTO teams (id, team_number, name, country, status, founder_user_id,
       owner_user_id, created_at, updated_at)
     VALUES (?1, ?2, 'Claimed Team', 'US', ?3, 'u-founder', 'u-founder', 1, 1)`,
  )
    .bind(`frc${number}`, number, status)
    .run();
  return { id: `frc${number}`, number };
}

const row = (sql: string, ...binds: unknown[]) =>
  testEnv.PLATFORM_DB.prepare(sql)
    .bind(...binds)
    .first();

const lastAction = (teamId: string) =>
  row(
    "SELECT action, reason, details, operator_user_id FROM operator_actions WHERE team_id = ? ORDER BY created_at DESC, rowid DESC",
    teamId,
  );

beforeAll(async () => {
  await testEnv.PLATFORM_DB.prepare(
    "INSERT OR IGNORE INTO operators (user_id, created_at) VALUES (?, 1)",
  )
    .bind(operator.id)
    .run();
});

describe("who may use the console", () => {
  it("says who's signed in and whether they're an operator", async () => {
    expect((await call(null, "/me")).status).toBe(401);
    expect(await (await call(student, "/me")).json()).toMatchObject({
      user: { id: student.id },
      isOperator: false,
    });
    expect(await (await call(operator, "/me")).json()).toMatchObject({ isOperator: true });
    // An operator on a shop kiosk isn't one there.
    expect(await (await call(kioskAdmin, "/me")).json()).toMatchObject({ isOperator: false });
  });

  it("is for operators only, never from a kiosk", async () => {
    expect((await call(null, "/teams")).status).toBe(401);
    expect((await call(student, "/teams")).status).toBe(403);
    expect((await call(kioskAdmin, "/teams")).status).toBe(403);
    expect((await call(operator, "/teams")).status).toBe(200);
  });

  it("only takes changes from the console's own pages", async () => {
    const { id } = await createTeam();
    const suspend = (origin: string | null) =>
      call(operator, `/teams/${id}/status`, {
        method: "POST",
        body: { status: "suspended", reason: "Looking into a report" },
        origin,
      });
    expect((await suspend(null)).status).toBe(403);
    expect((await suspend(`https://1234-orders.${site.platformDomain}`)).status).toBe(403);
    expect((await suspend(`https://admin.${site.domain}`)).status).toBe(403);
    expect((await suspend(`https://admin.${site.platformDomain}`)).status).toBe(200);
  });
});

describe("teams", () => {
  it("lists teams with their open reports", async () => {
    const { number } = await createTeam();
    await exports.default.fetch(
      new Request("http://platform/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamNumber: number, email: "a@b.org", message: "Not them." }),
      }),
    );
    const list = (await (await call(operator, `/teams?q=${number}`)).json()) as {
      teamNumber: number;
      openReports: number;
    }[];
    expect(list).toEqual([expect.objectContaining({ teamNumber: number, openReports: 1 })]);
  });

  it("shows a team with its members, owner and reports", async () => {
    const { id } = await createTeam();
    const detail = (await (await call(operator, `/teams/${id}`)).json()) as {
      team: { owner: { id: string; name: string } };
      members: { id: string }[];
    };
    expect(detail.team.owner).toEqual({ id: "u-founder", name: "Fay Founder" });
    expect(detail.members.map((m) => m.id)).toEqual(["u-founder", "u-member"]);
    // Seeing its members is an access the log records, once an hour per operator.
    await call(operator, `/teams/${id}`);
    const views = await testEnv.PLATFORM_DB.prepare(
      "SELECT operator_user_id FROM operator_actions WHERE team_id = ? AND action = 'view_team'",
    )
      .bind(id)
      .all();
    expect(views.results).toEqual([{ operator_user_id: operator.id }]);
  });

  it("keeps the log for 12 months", async () => {
    const { id } = await createTeam();
    const old = Math.floor(Date.now() / 1000) - 400 * 24 * 60 * 60;
    await testEnv.PLATFORM_DB.prepare(
      "INSERT INTO operator_actions (id, operator_user_id, action, team_id, created_at) VALUES (?, ?, 'view_team', ?, ?)",
    )
      .bind(crypto.randomUUID(), operator.id, id, old)
      .run();
    await call(operator, `/teams/${id}`);
    expect(
      await row("SELECT id FROM operator_actions WHERE team_id = ? AND created_at = ?", id, old),
    ).toBeNull();
  });

  it("deletes a team, once the operator gives a reason and types its number", async () => {
    const { id, number } = await createTeam();
    const del = (body: unknown) => call(operator, `/teams/${id}`, { method: "DELETE", body });
    expect((await del({ confirmNumber: number })).status).toBe(400);
    expect((await del({ reason: "False registration", confirmNumber: number + 1 })).status).toBe(
      400,
    );
    expect((await del({ reason: "False registration", confirmNumber: number })).status).toBe(200);

    expect(await row("SELECT id FROM teams WHERE id = ?", id)).toBeNull();
    const logged = await lastAction(id);
    expect(logged).toMatchObject({
      action: "delete_team",
      reason: "False registration",
      operator_user_id: operator.id,
    });
    expect(JSON.parse(logged?.details as string)).toMatchObject({
      teamNumber: number,
      deletedAccounts: 2,
    });
    // The number is free again.
    const signup = await exports.default.fetch(
      new Request("http://platform/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamNumber: number,
          name: "The Real Team",
          country: "US",
          acceptTerms: true,
        }),
      }),
    );
    expect(signup.status).toBe(201);
  });

  it("won't delete or suspend the site's own team", async () => {
    const reason = "Testing";
    expect(
      (
        await call(operator, `/teams/${teamKey}`, {
          method: "DELETE",
          body: { reason, confirmNumber: site.team.number },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(operator, `/teams/${teamKey}/status`, {
          method: "POST",
          body: { reason, status: "suspended" },
        })
      ).status,
    ).toBe(409);
  });

  it("hands a team to another member", async () => {
    const { id } = await createTeam();
    const transfer = (userId: string) =>
      call(operator, `/teams/${id}/owner`, {
        method: "POST",
        body: { reason: "The founder was a student; the lead mentor owns it", userId },
      });
    expect((await transfer("u-outsider")).status).toBe(400);
    expect((await transfer("u-member")).status).toBe(200);
    expect(await row("SELECT owner_user_id, founder_user_id FROM teams WHERE id = ?", id)).toEqual({
      owner_user_id: "u-member",
      founder_user_id: "u-founder",
    });
    expect(JSON.parse((await lastAction(id))?.details as string)).toMatchObject({
      from: "u-founder",
      to: "u-member",
    });
  });

  it("suspends a team, taking its addresses away until it's reactivated", async () => {
    const { id } = await createTeam();
    const status = (to: string) =>
      call(operator, `/teams/${id}/status`, {
        method: "POST",
        body: { reason: "Report under review", status: to },
      });
    expect((await status("suspended")).status).toBe(200);
    expect((await exports.default.fetch(`http://platform/api/teams/${id}`)).status).toBe(404);
    expect((await status("suspended")).status).toBe(409);
    expect((await status("active")).status).toBe(200);
    expect((await exports.default.fetch(`http://platform/api/teams/${id}`)).status).toBe(200);
  });
});

describe("reports and operators", () => {
  it("lists reports and closes them", async () => {
    const { number } = await createTeam();
    await exports.default.fetch(
      new Request("http://platform/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamNumber: number, email: "m@team.org", message: "We're them." }),
      }),
    );
    const open = (await (await call(operator, "/reports?status=open")).json()) as {
      id: string;
      teamNumber: number;
      teamName: string | null;
    }[];
    const report = open.find((r) => r.teamNumber === number);
    expect(report?.teamName).toBe("Claimed Team");

    const res = await call(operator, `/reports/${report?.id}`, {
      method: "POST",
      body: { status: "resolved" },
    });
    expect(res.status).toBe(200);
    expect(
      await row("SELECT status, resolved_by FROM number_reports WHERE id = ?", report?.id),
    ).toEqual({ status: "resolved", resolved_by: operator.id });
  });

  it("adds and removes operators, but not yourself", async () => {
    expect(
      (await call(operator, "/operators", { method: "POST", body: { userId: "u-nobody" } })).status,
    ).toBe(404);
    expect(
      (await call(operator, "/operators", { method: "POST", body: { userId: student.id } })).status,
    ).toBe(201);
    expect(await (await call(student, "/me")).json()).toMatchObject({ isOperator: true });

    const list = (await (await call(operator, "/operators")).json()) as { userId: string }[];
    expect(list.map((o) => o.userId)).toEqual(expect.arrayContaining([operator.id, student.id]));

    expect((await call(operator, `/operators/${operator.id}`, { method: "DELETE" })).status).toBe(
      409,
    );
    expect((await call(operator, `/operators/${student.id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect(await (await call(student, "/me")).json()).toMatchObject({ isOperator: false });
  });

  it("logs every action", async () => {
    const actions = (await (await call(operator, "/actions")).json()) as {
      action: string;
      operatorName: string;
    }[];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].operatorName).toBe(`Name of ${operator.id}`);
  });
});
