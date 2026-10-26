import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { type TestUser, asUser, teamUsers } from "@g3/testing/users";
import { describe, expect, it } from "vitest";
import { chatText, deliverToChat } from "../src/notifications";
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

type Extra = Partial<Record<string, { channel?: string | null; users?: string[] }>>;

/** Each type's home page audience and any channel or people, for Gearbox's, then the team's own. */
const settings = (
  portal: Record<string, string>,
  extra: Extra = {},
  teamPortal: Record<string, string> = { info: "everyone", critical: "everyone" },
  teamExtra: Extra = {},
) => {
  const group = (p: Record<string, string>, e: Extra) =>
    Object.fromEntries(
      ["info", "critical"].map((type) => [
        type,
        { portal: p[type], channel: null, users: [], ...e[type] },
      ]),
    );
  return { gearbox: group(portal, extra), team: group(teamPortal, teamExtra) };
};

const seen = async (user: TestUser) =>
  ((await (await call(user, "/team/notifications")).json()) as { id: string }[]).map((n) => n.id);

describe("a team's notification settings", () => {
  it("start with Gearbox's for admins and the team's own for everyone, nothing on chat", async () => {
    const team = await newTeam();
    const res = await call(team.admin, "/team/notification-settings");
    const body = (await res.json()) as { settings: unknown; members: { id: string }[] };
    expect(body.settings).toEqual(settings({ info: "admins", critical: "admins" }));
    expect(body.members.map((m) => m.id)).toEqual(["u-founder", "u-member"]);
  });

  it("are for admins only, and checked", async () => {
    const team = await newTeam();
    const ok = settings({ info: "everyone", critical: "nobody" });
    expect((await call(team.student, "/team/notification-settings")).status).toBe(403);
    const put = (body: unknown, user = team.admin) =>
      call(user, "/team/notification-settings", { method: "PUT", body });
    expect((await put(ok, team.student)).status).toBe(403);
    expect((await put(ok, team.kioskAdmin)).status).not.toBe(200);
    expect(
      (await put({ ...ok, team: { ...ok.team, info: { ...ok.team.info, portal: "all" } } })).status,
    ).toBe(400);
    expect((await put({ gearbox: ok.gearbox })).status).toBe(400);
    expect(
      (
        await put(
          settings(
            { info: "everyone", critical: "admins" },
            {
              info: { channel: "general" },
            },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await put(
          settings(
            { info: "everyone", critical: "admins" },
            {
              critical: { users: ["someone-else"] },
            },
          ),
        )
      ).status,
    ).toBe(400);
    const saved = settings(
      { info: "everyone", critical: "nobody" },
      // Only Gearbox's Critical ones are DMed: people for anything else are left out.
      { info: { users: ["u-member"] }, critical: { channel: "C0123456789", users: ["u-founder"] } },
      { info: "admins", critical: "everyone" },
      { info: { channel: "C0987654321", users: ["u-member"] } },
    );
    expect((await put(saved)).status).toBe(200);
    const body = (await (await call(team.admin, "/team/notification-settings")).json()) as {
      settings: unknown;
    };
    expect(body.settings).toEqual(
      settings(
        { info: "everyone", critical: "nobody" },
        { critical: { channel: "C0123456789", users: ["u-founder"] } },
        { info: "admins", critical: "everyone" },
        { info: { channel: "C0987654321" } },
      ),
    );
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
    const critical = await addNotification("critical");
    const expired = await addNotification("info", nowS() - 1);

    // Defaults: admins see every type.
    expect(await seen(team.admin)).toEqual(expect.arrayContaining([info, critical]));
    expect(await seen(team.student)).not.toContain(info);

    await call(team.admin, "/team/notification-settings", {
      method: "PUT",
      body: settings({ info: "everyone", critical: "admins" }),
    });
    const student = await seen(team.student);
    expect(student).toContain(info);
    expect(student).not.toContain(critical);
    expect(student).not.toContain(expired);
    expect(await seen(team.admin)).toEqual(expect.arrayContaining([info, critical]));
    // A kiosk session is never an admin.
    expect(await seen(team.kioskAdmin)).not.toContain(critical);

    await call(team.admin, "/team/notification-settings", {
      method: "PUT",
      body: settings({ info: "everyone", critical: "nobody" }),
    });
    expect(await seen(team.admin)).not.toContain(critical);
  });
});

describe("chat delivery", () => {
  it("sends to each active team's chosen channels and people for that type", async () => {
    const team = await newTeam();
    const quiet = await newTeam();
    const suspended = await newTeam("suspended");
    const chosen = settings(
      { info: "admins", critical: "admins" },
      { critical: { channel: "C0123456789", users: ["u-founder"] } },
    );
    await call(team.admin, "/team/notification-settings", { method: "PUT", body: chosen });
    await call(suspended.admin, "/team/notification-settings", { method: "PUT", body: chosen });

    await deliverToChat(testEnv, { type: "info", summary: "Not this", body: "x" });
    await deliverToChat(testEnv, { type: "critical", summary: "Read now", body: "Details" });

    const sent = async (teamId: string, path: string) =>
      (await (
        await testEnv.G3ID.fetch(`http://g3id/api/internal/teams/${teamId}${path}`)
      ).json()) as { channel?: string; userIds?: string[]; text: string }[];
    const posts = await sent(team.teamId, "/chat/message");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: "C0123456789" });
    // Plainly Gearbox's, with the notification quoted.
    expect(posts[0].text).toBe("🚨  **Gearbox Critical Notification**\n> **Read now**\n> Details");
    expect(await sent(team.teamId, "/chat/dm-members")).toMatchObject([{ userIds: ["u-founder"] }]);
    expect(await sent(quiet.teamId, "/chat/message")).toEqual([]);
    expect(await sent(suspended.teamId, "/chat/message")).toEqual([]);
  });
});

describe("a notification's chat text", () => {
  it("stays under the length limit, keeping its heading and quote bars", () => {
    const text = chatText({ type: "info", summary: "Long", body: "word ".repeat(2000) });
    expect(text.length).toBeLessThanOrEqual(3900);
    expect(text.startsWith("ℹ️  **Gearbox Informational Notification**\n> **Long**")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("a team's own notifications", () => {
  const inADay = () => nowS() + 86400;
  const write = (user: TestUser, body: unknown) =>
    call(user, "/team/notifications", { method: "POST", body });
  const sent = async (teamId: string, path: string) =>
    (await (
      await testEnv.G3ID.fetch(`http://g3id/api/internal/teams/${teamId}${path}`)
    ).json()) as { channel?: string; userIds?: string[]; text: string }[];

  it("are written and deleted by the team's admins, and checked", async () => {
    const team = await newTeam();
    const input = {
      type: "info",
      summary: "Meeting moved",
      body: "Thursday.",
      expiresAt: inADay(),
    };
    expect((await write(team.student, input)).status).toBe(403);
    expect((await write(team.kioskAdmin, input)).status).not.toBe(201);
    expect((await write(team.admin, { ...input, type: "warning" })).status).toBe(400);
    expect((await write(team.admin, { ...input, summary: "" })).status).toBe(400);
    expect((await write(team.admin, { ...input, expiresAt: nowS() - 1 })).status).toBe(400);
    expect((await call(team.student, "/team/notifications/written")).status).toBe(403);

    const res = await write(team.admin, input);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const written = (await (await call(team.admin, "/team/notifications/written")).json()) as {
      id: string;
      createdBy: string;
    }[];
    expect(written.find((n) => n.id === id)).toMatchObject({
      summary: "Meeting moved",
      createdBy: team.admin.id,
    });

    const other = await newTeam();
    expect(
      (await call(other.admin, `/team/notifications/${id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await call(team.admin, `/team/notifications/${id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect(await seen(team.admin)).not.toContain(id);
  });

  it("show only to their own team, by its settings, with the writer's name", async () => {
    const team = await newTeam();
    const other = await newTeam();
    // Gearbox's are hidden from members, the team's own shown.
    await call(team.admin, "/team/notification-settings", {
      method: "PUT",
      body: settings({ info: "admins", critical: "admins" }),
    });
    await call(other.admin, "/team/notification-settings", {
      method: "PUT",
      body: settings({ info: "everyone", critical: "everyone" }),
    });
    const { id } = (await (
      await write(team.admin, {
        type: "info",
        summary: "Bring safety glasses",
        body: "Every meeting.",
        expiresAt: inADay(),
      })
    ).json()) as { id: string };
    const gearbox = await addNotification("info");
    const list = (await (await call(team.student, "/team/notifications")).json()) as {
      id: string;
      fromTeam: boolean;
      createdByName: string | null;
    }[];
    expect(list.find((n) => n.id === id)).toMatchObject({
      fromTeam: true,
      createdByName: expect.any(String),
    });
    expect(await seen(other.admin)).not.toContain(id);
    expect(await seen(other.student)).not.toContain(id);

    expect(list.find((n) => n.id === gearbox)).toBeUndefined();
    // Gearbox's own name no writer.
    const admin = (await (await call(team.admin, "/team/notifications")).json()) as {
      id: string;
      fromTeam: boolean;
      createdByName: string | null;
    }[];
    expect(admin.find((n) => n.id === gearbox)).toMatchObject({
      fromTeam: false,
      createdByName: null,
    });

    // The team's own by its own setting.
    await call(team.admin, "/team/notification-settings", {
      method: "PUT",
      body: settings(
        { info: "everyone", critical: "everyone" },
        {},
        {
          info: "nobody",
          critical: "everyone",
        },
      ),
    });
    expect(await seen(team.student)).not.toContain(id);
    expect(await seen(team.student)).toContain(gearbox);
  });

  it("go only to their own team's chat, under the writer's name", async () => {
    const team = await newTeam();
    const other = await newTeam();
    // Gearbox's settings don't send the team's own.
    const chosen = settings(
      { info: "admins", critical: "admins" },
      { critical: { channel: "C0111111111", users: ["u-founder"] } },
      { info: "everyone", critical: "everyone" },
      { critical: { channel: "C0123456789" } },
    );
    await call(team.admin, "/team/notification-settings", { method: "PUT", body: chosen });
    await call(other.admin, "/team/notification-settings", { method: "PUT", body: chosen });

    await deliverToChat(
      testEnv,
      { type: "critical", summary: "Shop closed", body: "Power's out." },
      { id: team.teamId, from: "Pat Lee" },
    );
    const posts = await sent(team.teamId, "/chat/message");
    expect(posts.map((p) => p.text)).toContain(
      "🚨  **Critical Notification from Pat Lee**\n> **Shop closed**\n> Power's out.",
    );
    expect(posts.map((p) => p.channel)).not.toContain("C0111111111");
    expect(await sent(team.teamId, "/chat/dm-members")).toEqual([]);
    expect(await sent(other.teamId, "/chat/message")).toEqual([]);
  });
});
