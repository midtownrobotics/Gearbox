import { site, teamKey } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "../src/lib/cookie";
import { handleSlackCode } from "../src/lib/slack-code";
import { saveInstallation, slackForTeam, teamForWorkspace } from "../src/lib/slack-install";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// Slack per team (roadmap 2.6): one Slack app, installed into each team's workspace by its admins.
// The test config stubs Slack's API and sets the site team's pre-teams settings
// (SLACK_TEAM_ID from wrangler.toml, SLACK_BOT_TOKEN "xoxb-site").

const workspace = () => `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const install = async (teamId: string, workspaceId: string) =>
  saveInstallation(testEnv, {
    teamId,
    workspaceId,
    workspaceName: "Their Slack",
    botUserId: "UBOT",
    botToken: `xoxb-${workspaceId}`,
    installedBy: await createUser({ teamId, isAdmin: true }),
  });

describe("each team's workspace", () => {
  it("keeps the site team on its settings until it connects through G3ID", async () => {
    expect(await teamForWorkspace(testEnv, testEnv.SLACK_TEAM_ID)).toBe(teamKey);
    expect(await slackForTeam(testEnv, teamKey)).toMatchObject({
      workspaceId: testEnv.SLACK_TEAM_ID,
      fromSettings: true,
      slack: { SLACK_BOT_TOKEN: "xoxb-site" },
    });
  });

  it("stores a team's bot token encrypted and finds the team by workspace", async () => {
    const team = await createTeam();
    const ws = workspace();
    expect(await install(team, ws)).toBe("saved");

    expect(await teamForWorkspace(testEnv, ws)).toBe(team);
    expect(await slackForTeam(testEnv, team)).toMatchObject({
      workspaceId: ws,
      fromSettings: false,
      slack: { SLACK_BOT_TOKEN: `xoxb-${ws}` },
    });
    const stored = await testEnv.DB.prepare(
      "SELECT bot_token_encrypted FROM slack_installations WHERE team_id = ?",
    )
      .bind(team)
      .first<{ bot_token_encrypted: string }>();
    expect(stored?.bot_token_encrypted).not.toContain("xoxb");
  });

  it("won't connect one workspace to two teams", async () => {
    const ws = workspace();
    expect(await install(await createTeam(), ws)).toBe("saved");
    expect(await install(await createTeam(), ws)).toBe("taken");
    expect(await install(await createTeam(), testEnv.SLACK_TEAM_ID)).toBe("taken");
  });

  it("has no Slack for a team that hasn't connected one", async () => {
    expect(await slackForTeam(testEnv, await createTeam())).toBeNull();
    expect(await teamForWorkspace(testEnv, workspace())).toBeNull();
  });
});

describe("connecting Slack", () => {
  it("lets only admins start, for their own team", async () => {
    const team = await createTeam();
    const student = await sessionCookie(await createUser({ teamId: team }));
    expect((await g3id("/slack/install", { cookie: student, redirect: "manual" })).status).toBe(
      403,
    );

    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    const res = await g3id("/slack/install", { cookie: admin, redirect: "manual" });
    const slack = new URL(res.headers.get("Location") as string);
    expect(slack.origin + slack.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(slack.searchParams.get("scope")).toContain("commands");
    const state = await testEnv.RATE_LIMIT.get(`slack_install:${slack.searchParams.get("state")}`);
    expect(JSON.parse(state as string)).toMatchObject({ team });
  });

  it("saves the workspace when Slack sends the admin back, and shows it on the admin page", async () => {
    const team = await createTeam();
    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    const start = await g3id("/slack/install", { cookie: admin, redirect: "manual" });
    const state = new URL(start.headers.get("Location") as string).searchParams.get("state");
    const ws = workspace();

    const back = await g3id(`/slack/oauth/callback?code=ws:${ws}&state=${state}`, {
      redirect: "manual",
    });
    expect(back.headers.get("Location")).toMatch(/\/admin\/slack\?connected=1$/);
    expect(await teamForWorkspace(testEnv, ws)).toBe(team);
    expect(await (await g3id("/admin/slack", { cookie: admin })).json()).toMatchObject({
      connected: true,
      workspaceId: ws,
      workspaceName: `Workspace ${ws}`,
      fromSettings: false,
    });

    // The state works once.
    const again = await g3id(`/slack/oauth/callback?code=ws:${ws}&state=${state}`, {
      redirect: "manual",
    });
    expect(again.headers.get("Location")).toContain("error=");
  });

  it("lets an admin disconnect it", async () => {
    const team = await createTeam();
    const ws = workspace();
    await install(team, ws);
    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    expect((await g3id("/admin/slack", { method: "DELETE", cookie: admin })).status).toBe(200);
    expect(await teamForWorkspace(testEnv, ws)).toBeNull();
  });
});

describe("Slack sign-in codes", () => {
  async function codeFor(teamId: string): Promise<string> {
    const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    await testEnv.DB.prepare(
      "INSERT INTO core_slack_link_codes (id, team_id, code, type, polling_token, expires_at, created_at) VALUES (?, ?, ?, 'signin', ?, ?, 0) ON CONFLICT (code) DO UPDATE SET team_id = excluded.team_id, used = 0, expires_at = excluded.expires_at",
    )
      .bind(crypto.randomUUID(), teamId, code, crypto.randomUUID(), 9_999_999_999)
      .run();
    return code;
  }

  const send = (code: string, workspaceId: string) =>
    handleSlackCode({
      code,
      slackUserId: `U${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      workspaceId,
      type: "signin",
      env: testEnv,
    });

  it("only takes a code from its own team's workspace", async () => {
    const team = await createTeam();
    const ws = workspace();
    await install(team, ws);

    const fromSite = await send(await codeFor(team), testEnv.SLACK_TEAM_ID);
    expect(fromSite).toMatchObject({ success: false });
    expect(fromSite.message).toContain("another team");

    const fromNowhere = await send(await codeFor(team), workspace());
    expect(fromNowhere.message).toContain("isn't connected");
  });
});

describe("Slack events", () => {
  async function signed(body: unknown) {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(testEnv.SLACK_SIGNING_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`v0:${timestamp}:${raw}`),
    );
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return g3id("/slack/events", {
      method: "POST",
      headers: { "X-Slack-Request-Timestamp": timestamp, "X-Slack-Signature": `v0=${hex}` },
      body,
    });
  }

  it("forgets a workspace when the app is removed from it", async () => {
    const team = await createTeam();
    const ws = workspace();
    await install(team, ws);
    const res = await signed({
      type: "event_callback",
      team_id: ws,
      event: { type: "app_uninstalled" },
    });
    expect(res.status).toBe(200);
    expect(await teamForWorkspace(testEnv, ws)).toBeNull();
  });
});

describe("signing a team up", () => {
  const internal = (path: string, init: Parameters<typeof g3id>[1] = {}) =>
    g3id(`/internal${path}`, init);

  it("makes the team's first member its admin, through the founder's code", async () => {
    // What the platform's sign-up does, in order.
    const number = 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);
    const team = `frc${number}`;
    const put = await internal("/teams", {
      method: "PUT",
      body: { id: team, teamNumber: number, name: "Signed Up" },
    });
    expect(put.status).toBe(200);
    const ws = workspace();
    const installed = await internal("/slack-installations", {
      method: "POST",
      body: {
        teamId: team,
        workspaceId: ws,
        workspaceName: "Theirs",
        botUserId: "U1",
        botToken: "xoxb-x",
      },
    });
    expect(installed.status).toBe(200);
    const home = `https://${number}.${site.platformDomain}/`;
    const { code, token } = (await (
      await internal("/signup-codes", { method: "POST", body: { teamId: team, redirect: home } })
    ).json()) as { code: string; token: string };
    expect(await (await internal(`/signup-codes/${token}`)).json()).toMatchObject({
      status: "pending",
    });

    // The founder sends it from the team's workspace.
    const founder = `U${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const result = await handleSlackCode({
      code,
      slackUserId: founder,
      workspaceId: ws,
      type: "signin",
      env: testEnv,
    });
    expect(result).toMatchObject({ success: true, token, redirectUrl: home });

    const status = (await (await internal(`/signup-codes/${token}`)).json()) as {
      status: string;
      userId: string;
    };
    expect(status.status).toBe("success");
    const user = await testEnv.DB.prepare(
      "SELECT team_id, status, is_admin, email FROM core_users WHERE id = ?",
    )
      .bind(status.userId)
      .first();
    expect(user).toEqual({
      team_id: team,
      status: "active",
      is_admin: 1,
      email: `${founder.toLowerCase()}@slack.test`,
    });

    // The next person waits for that admin's approval.
    const second = await internal("/signup-codes", {
      method: "POST",
      body: { teamId: team, redirect: null },
    });
    const next = (await second.json()) as { code: string; token: string };
    const joined = await handleSlackCode({
      code: next.code,
      slackUserId: `U${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      workspaceId: ws,
      type: "signin",
      env: testEnv,
    });
    expect(joined.message).toContain("pending admin approval");
  });

  it("won't connect a workspace that's already another team's", async () => {
    const res = await internal("/slack-installations", {
      method: "POST",
      body: {
        teamId: await createTeam(),
        workspaceId: testEnv.SLACK_TEAM_ID,
        workspaceName: null,
        botUserId: null,
        botToken: "xoxb-x",
      },
    });
    expect(res.status).toBe(409);
  });
});

describe("the session cookie", () => {
  it("is set for the domain the request came in on", () => {
    expect(sessionCookieOptions(`https://g3id.${site.domain}/api/auth/x`).domain).toBe(site.domain);
    expect(sessionCookieOptions(`https://254-id.${site.platformDomain}/api/x`).domain).toBe(
      site.platformDomain,
    );
    // Local dev: the gateway's addresses share gearbox.localhost (browsers won't share "localhost").
    expect(sessionCookieOptions("http://1648-id.gearbox.localhost:8796/api/x").domain).toBe(
      "gearbox.localhost",
    );
  });
});
