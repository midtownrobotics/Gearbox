import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { type TestUser, asUser, teamUsers } from "@g3/testing/users";
import { describe, expect, it } from "vitest";
import { deliverToSlack } from "../src/notifications";
import type { AppEnv } from "../src/types";

// Delivering the console's notifications: each team's settings (its admin pages), what its home
// page shows to whom, and Slack. G3ID is stubbed in vitest.config.mts: every team has "u-founder"
// (Slack linked) and "u-member", and Slack posts and DMs are recorded.

const testEnv = env as unknown as AppEnv["Bindings"];

async function newTeam(status = "active") {
  const number = 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000);
  const id = `frc${number}`;
  await testEnv.PLATFORM_DB.prepare(
    `INSERT INTO teams (id, team_number, name, country, status, created_at, updated_at)
     VALUES (?1, ?2, 'A Team', 'US', ?3, 1, 1)`,
  )
    .bind(id, number, status)
    .run();
  return teamUsers(id);
}

function call(user: TestUser, path: string, init: { method?: string; body?: unknown } = {}) {
  return exports.default.fetch(new Request(`http://platform/api${path}`, asUser(user, init)));
}

const nowS = () => Math.floor(Date.now() / 1000);

/** A notification as the console writes it (straight into the table). */
async function addNotification(type: string, expiresAt = nowS() + 3600) {
  const id = crypto.randomUUID();
  await testEnv.PLATFORM_DB.prepare(
    `INSERT INTO notifications (id, type, summary, body, expires_at, created_by, created_at)
     VALUES (?1, ?2, ?3, 'Body', ?4, 'op', ?5)`,
  )
    .bind(id, type, `Summary ${id}`, expiresAt, nowS())
    .run();
  return id;
}

const settings = (
  portal: Record<string, string>,
  slack: Partial<Record<string, { slackChannel?: string | null; slackUsers?: string[] }>> = {},
) =>
  Object.fromEntries(
    ["info", "warning", "critical"].map((type) => [
      type,
      { portal: portal[type], slackChannel: null, slackUsers: [], ...slack[type] },
    ]),
  );

const seen = async (user: TestUser) =>
  ((await (await call(user, "/team/notifications")).json()) as { id: string }[]).map((n) => n.id);

describe("a team's notification settings", () => {
  it("start with admins on the home page and nothing on Slack", async () => {
    const team = await newTeam();
    const res = await call(team.admin, "/team/notification-settings");
    const body = (await res.json()) as { settings: unknown; members: { id: string }[] };
    expect(body.settings).toEqual(
      settings({ info: "admins", warning: "admins", critical: "admins" }),
    );
    expect(body.members.map((m) => m.id)).toEqual(["u-founder", "u-member"]);
  });

  it("are for admins only, and checked", async () => {
    const team = await newTeam();
    const ok = settings({ info: "everyone", warning: "admins", critical: "nobody" });
    expect((await call(team.student, "/team/notification-settings")).status).toBe(403);
    const put = (body: unknown, user = team.admin) =>
      call(user, "/team/notification-settings", { method: "PUT", body });
    expect((await put(ok, team.student)).status).toBe(403);
    expect((await put(ok, team.kioskAdmin)).status).not.toBe(200);
    expect((await put({ ...ok, info: { ...ok.info, portal: "all" } })).status).toBe(400);
    expect(
      (
        await put(
          settings(
            { info: "everyone", warning: "admins", critical: "admins" },
            {
              info: { slackChannel: "general" },
            },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await put(
          settings(
            { info: "everyone", warning: "admins", critical: "admins" },
            {
              info: { slackUsers: ["someone-else"] },
            },
          ),
        )
      ).status,
    ).toBe(400);
    const saved = settings(
      { info: "everyone", warning: "admins", critical: "nobody" },
      { critical: { slackChannel: "C0123456789", slackUsers: ["u-founder"] } },
    );
    expect((await put(saved)).status).toBe(200);
    const body = (await (await call(team.admin, "/team/notification-settings")).json()) as {
      settings: Record<string, { slackChannel: string | null }>;
    };
    expect(body.settings.critical.slackChannel).toBe("C0123456789");
    const log = await testEnv.PLATFORM_DB.prepare(
      "SELECT details FROM team_audit_log WHERE team_id = ? AND action = 'settings_changed'",
    )
      .bind(team.teamId)
      .first<{ details: string }>();
    expect(JSON.parse(log?.details ?? "{}")).toMatchObject({ what: "Notifications" });
  });
});

describe("the home page's notifications", () => {
  it("show each type to whom the team chose, until they expire", async () => {
    const team = await newTeam();
    const info = await addNotification("info");
    const warning = await addNotification("warning");
    const critical = await addNotification("critical");
    const expired = await addNotification("info", nowS() - 1);

    // Defaults: admins see every type.
    expect(await seen(team.admin)).toEqual(expect.arrayContaining([info, warning, critical]));
    expect(await seen(team.student)).not.toContain(info);

    await call(team.admin, "/team/notification-settings", {
      method: "PUT",
      body: settings({ info: "everyone", warning: "admins", critical: "nobody" }),
    });
    const student = await seen(team.student);
    expect(student).toContain(info);
    expect(student).not.toContain(warning);
    expect(student).not.toContain(expired);
    const admin = await seen(team.admin);
    expect(admin).toEqual(expect.arrayContaining([info, warning]));
    expect(admin).not.toContain(critical);
    // A kiosk session is never an admin.
    expect(await seen(team.kioskAdmin)).not.toContain(warning);
  });
});

describe("Slack delivery", () => {
  it("sends to each active team's chosen channels and people for that type", async () => {
    const team = await newTeam();
    const quiet = await newTeam();
    const suspended = await newTeam("suspended");
    const chosen = settings(
      { info: "admins", warning: "admins", critical: "admins" },
      { critical: { slackChannel: "C0123456789", slackUsers: ["u-founder"] } },
    );
    await call(team.admin, "/team/notification-settings", { method: "PUT", body: chosen });
    await call(suspended.admin, "/team/notification-settings", { method: "PUT", body: chosen });

    await deliverToSlack(testEnv, { type: "warning", summary: "Not this", body: "x" });
    await deliverToSlack(testEnv, { type: "critical", summary: "Read now", body: "Details" });

    const sent = async (teamId: string, path: string) =>
      (await (
        await testEnv.G3ID.fetch(`http://g3id/api/internal/teams/${teamId}${path}`)
      ).json()) as { channel?: string; userIds?: string[]; text: string }[];
    const posts = await sent(team.teamId, "/slack/message");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: "C0123456789" });
    expect(posts[0].text).toContain("Read now");
    expect(await sent(team.teamId, "/slack/dm-members")).toMatchObject([
      { userIds: ["u-founder"] },
    ]);
    expect(await sent(quiet.teamId, "/slack/message")).toEqual([]);
    expect(await sent(suspended.teamId, "/slack/message")).toEqual([]);
  });
});
