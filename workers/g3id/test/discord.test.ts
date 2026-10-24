import { teamAppUrlVia } from "@g3/site-config";
import { DISCORD_CHANNELS, snowflake } from "@g3/testing/discord";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUserIdentities, coreUsers } from "../src/db/schema";
import { discordForTeam, saveDiscordInstallation } from "../src/lib/discord-install";
import { newId } from "../src/lib/id";
import { saveInstallation } from "../src/lib/slack-install";
import { cookieFrom, createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// Discord beside Slack (docs/roadmap/discord.md): an admin adds the bot to the team's server,
// members sign in with Discord's OAuth (someone new only if they're in the server), and apps'
// messages go out on Discord. Discord is @g3/testing's fake (packages/testing/src/discord.ts).

const portal = (team: string) => teamAppUrlVia(undefined, team, "portal");

/** A team with its Discord server connected. */
async function teamWithDiscord(guildId = snowflake("5")) {
  const team = await createTeam();
  expect(
    await saveDiscordInstallation(testEnv, {
      teamId: team,
      guildId,
      guildName: "Their Server",
      installedBy: null,
    }),
  ).toBe("saved");
  return { team, guildId };
}

/** A member with a Discord account linked. */
async function memberWithDiscord(teamId: string, user: { isAdmin?: boolean } = {}) {
  const userId = await createUser({ teamId, ...user });
  const discordId = snowflake("5");
  const now = Math.floor(Date.now() / 1000);
  await createDb(testEnv.DB).insert(coreUserIdentities).values({
    id: newId(),
    userId,
    provider: "discord",
    providerId: discordId,
    createdAt: now,
    updatedAt: now,
  });
  return { userId, discordId };
}

/** Where a start route sends the browser, and the state it carries. */
async function startAt(path: string, init: Parameters<typeof g3id>[1] = {}) {
  const res = await g3id(path, { ...init, redirect: "manual" });
  const to = new URL(res.headers.get("Location") as string);
  return { to, state: to.searchParams.get("state") };
}

const callback = (state: string | null, code: string) =>
  g3id(`/auth/discord/callback?code=${encodeURIComponent(code)}&state=${state}`, {
    redirect: "manual",
  });

const sentTo = async (channel: string) =>
  (
    (await (await fetch("https://discord.com/__sent")).json()) as {
      channel: string;
      content: string;
    }[]
  ).filter((m) => m.channel === channel);

describe("connecting Discord", () => {
  it("lets only admins start, asking Discord to add the bot", async () => {
    const team = await createTeam();
    const student = await sessionCookie(await createUser({ teamId: team }));
    const refused = await g3id("/auth/discord/install", { cookie: student, redirect: "manual" });
    expect(refused.status).toBe(403);

    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    const { to } = await startAt("/auth/discord/install", { cookie: admin });
    expect(to.origin + to.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(to.searchParams.get("scope")).toContain("bot");
  });

  it("saves the server when Discord sends the admin back, and links the admin's Discord", async () => {
    const team = await createTeam();
    const adminId = await createUser({ teamId: team, isAdmin: true });
    const admin = await sessionCookie(adminId);
    const { state } = await startAt("/auth/discord/install", { cookie: admin });
    const guild = snowflake("5");
    const discordUser = snowflake("5");

    const back = await callback(state, `u:${discordUser}:g:${guild}`);
    expect(back.headers.get("Location")).toBe(
      `${portal(team)}/admin/integrations?connected=discord`,
    );
    expect(await (await g3id("/admin/discord", { cookie: admin })).json()).toMatchObject({
      connected: true,
      guildId: guild,
      guildName: `Server ${guild}`,
    });
    const linked = await createDb(testEnv.DB)
      .select({ userId: coreUserIdentities.userId })
      .from(coreUserIdentities)
      .where(eq(coreUserIdentities.providerId, discordUser))
      .get();
    expect(linked?.userId).toBe(adminId);

    // The state works once.
    const again = await callback(state, `u:${discordUser}:g:${guild}`);
    expect(again.headers.get("Location")).toContain("error=");
  });

  it("is refused while the team has Slack, and for another team's server", async () => {
    const team = await createTeam();
    await saveInstallation(testEnv, {
      teamId: team,
      workspaceId: `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      workspaceName: "Slack",
      botUserId: null,
      botToken: "xoxb-x",
      installedBy: null,
    });
    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    const { state } = await startAt("/auth/discord/install", { cookie: admin });
    const back = await callback(state, `u:${snowflake("5")}:g:${snowflake("5")}`);
    expect(back.headers.get("Location")).toContain(
      encodeURIComponent("Disconnect Slack before connecting Discord."),
    );

    const { guildId } = await teamWithDiscord();
    const other = await createTeam();
    expect(
      await saveDiscordInstallation(testEnv, {
        teamId: other,
        guildId,
        guildName: null,
        installedBy: null,
      }),
    ).toBe("taken");
  });

  it("keeps Slack from being connected while the team has Discord", async () => {
    const { team } = await teamWithDiscord();
    expect(
      await saveInstallation(testEnv, {
        teamId: team,
        workspaceId: "TNEWSLACK1",
        workspaceName: null,
        botUserId: null,
        botToken: "xoxb-y",
        installedBy: null,
      }),
    ).toBe("discord");
  });

  it("lets an admin disconnect it", async () => {
    const { team } = await teamWithDiscord();
    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    expect((await g3id("/admin/discord", { method: "DELETE", cookie: admin })).status).toBe(200);
    expect(await discordForTeam(testEnv, team)).toBeNull();
  });
});

describe("signing in with Discord", () => {
  const signIn = async (team: string, discordId: string) => {
    const { state } = await startAt("/auth/discord", { headers: { "X-Team-Id": team } });
    return callback(state, `u:${discordId}`);
  };

  it("makes Discord the team's chat sign-in, in Slack's place", async () => {
    const { team } = await teamWithDiscord();
    const methods = (await (
      await g3id("/team/sign-in", { headers: { "X-Team-Id": team } })
    ).json()) as Record<string, boolean>;
    expect(methods).toMatchObject({ discord: true, slack: false });
    expect(await (await g3id("/team/chat", { headers: { "X-Team-Id": team } })).json()).toEqual({
      provider: "discord",
    });

    // A team on Slack doesn't sign in with Discord.
    const slackTeam = await createTeam();
    const off = await g3id("/auth/discord", {
      headers: { "X-Team-Id": slackTeam },
      redirect: "manual",
    });
    expect(off.headers.get("Location")).toContain("/login/error");
  });

  it("signs in a member with Discord linked", async () => {
    const { team } = await teamWithDiscord();
    const { userId, discordId } = await memberWithDiscord(team);
    const res = await signIn(team, discordId);
    expect(res.headers.get("Location")).toBe(`${portal(team)}/`);
    const me = await g3id("/auth/me", { cookie: cookieFrom(res) ?? "" });
    expect(((await me.json()) as { id: string }).id).toBe(userId);
  });

  it("signs up someone new from the team's server, who enters their name before admins hear of it", async () => {
    const { team } = await teamWithDiscord();
    const admin = await memberWithDiscord(team, { isAdmin: true });
    const newcomer = snowflake("5");
    const res = await signIn(team, newcomer);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.pathname).toBe("/signup/name");
    expect(cookieFrom(res)).toBeNull();
    const user = await createDb(testEnv.DB)
      .select({
        id: coreUsers.id,
        status: coreUsers.status,
        displayName: coreUsers.displayName,
        username: coreUsers.username,
      })
      .from(coreUsers)
      .where(eq(coreUsers.email, `${newcomer}@discord.test`))
      .get();
    const discordName = `Member ${newcomer.slice(-4)}`;
    expect(user).toMatchObject({
      status: "pending",
      displayName: discordName,
      username: discordName,
    });
    const before = (await sentTo(`dm-${admin.discordId}`)).length;

    // Their page starts from their Discord name, and saving it tells the admins.
    const token = location.searchParams.get("token") ?? "";
    const headers = { "X-Team-Id": team };
    const step = await g3id(`/auth/signup/name?token=${token}`, { headers });
    expect(await step.json()).toEqual({ username: discordName });
    expect((await sentTo(`dm-${admin.discordId}`)).length).toBe(before);
    const saved = await g3id("/auth/signup/name", {
      method: "POST",
      headers,
      body: { token, name: "  Ada   Lovelace " },
    });
    expect(saved.status).toBe(200);
    const named = await createDb(testEnv.DB)
      .select({ displayName: coreUsers.displayName, username: coreUsers.username })
      .from(coreUsers)
      .where(eq(coreUsers.id, user?.id ?? ""))
      .get();
    expect(named).toEqual({ displayName: "Ada Lovelace", username: discordName });
    const dms = await sentTo(`dm-${admin.discordId}`);
    expect(dms.length).toBe(before + 1);
    expect(dms.at(-1)?.content).toContain("Ada Lovelace");
    expect(dms.at(-1)?.content).toContain(`${discordName} on Discord`);
    expect(dms.at(-1)?.content).toContain("is waiting for approval");

    // The token is spent, and signing in again says they're waiting.
    const again = await g3id("/auth/signup/name", {
      method: "POST",
      headers,
      body: { token, name: "Someone Else" },
    });
    expect(again.status).toBe(404);
    expect((await signIn(team, newcomer)).headers.get("Location")).toMatch(/\/signup\/pending$/);
  });

  it("asks for the name again of someone who left before entering it", async () => {
    const { team } = await teamWithDiscord();
    await memberWithDiscord(team, { isAdmin: true });
    const newcomer = snowflake("5");
    await signIn(team, newcomer);
    const again = new URL((await signIn(team, newcomer)).headers.get("Location") ?? "");
    expect(again.pathname).toBe("/signup/name");
    // Only on the team's own address.
    const token = again.searchParams.get("token") ?? "";
    const elsewhere = await g3id(`/auth/signup/name?token=${token}`, {
      headers: { "X-Team-Id": await createTeam() },
    });
    expect(elsewhere.status).toBe(404);
  });

  it("makes a team's first member its admin", async () => {
    const { team } = await teamWithDiscord();
    const founder = snowflake("5");
    const res = await signIn(team, founder);
    expect(cookieFrom(res)).not.toBeNull();
    const user = await createDb(testEnv.DB)
      .select({ isAdmin: coreUsers.isAdmin, status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.email, `${founder}@discord.test`))
      .get();
    expect(user).toEqual({ isAdmin: 1, status: "active" });
  });

  it("turns away someone who isn't in the team's server, or has no verified email", async () => {
    const { team } = await teamWithDiscord();
    await createUser({ teamId: team, isAdmin: true });
    const outsider = await signIn(team, snowflake("7"));
    expect(decodeURIComponent(outsider.headers.get("Location") ?? "")).toContain(
      "Join your team's Discord server first",
    );
    const unverified = await signIn(team, snowflake("6"));
    expect(decodeURIComponent(unverified.headers.get("Location") ?? "")).toContain(
      "no verified email",
    );
  });

  it("keeps a member to their own team", async () => {
    const { team } = await teamWithDiscord();
    const { discordId } = await memberWithDiscord(team);
    const { team: other } = await teamWithDiscord();
    const res = await signIn(other, discordId);
    expect(decodeURIComponent(res.headers.get("Location") ?? "")).toContain("another team");
  });

  it("links Discord to a signed-in member's account", async () => {
    const { team } = await teamWithDiscord();
    const userId = await createUser({ teamId: team });
    const { state } = await startAt("/auth/discord/link", { cookie: await sessionCookie(userId) });
    const discordId = snowflake("5");
    const res = await callback(state, `u:${discordId}`);
    expect(res.headers.get("Location")).toBe(`${portal(team)}/account`);
    const linked = await createDb(testEnv.DB)
      .select({ userId: coreUserIdentities.userId })
      .from(coreUserIdentities)
      .where(eq(coreUserIdentities.providerId, discordId))
      .get();
    expect(linked?.userId).toBe(userId);
  });
});

describe("messages on Discord", () => {
  const post = (teamId: string, body: unknown) =>
    g3id(`/internal/teams/${teamId}/chat/message`, { method: "POST", body });

  it("post to the team's channel as written, in pieces Discord takes", async () => {
    const { team } = await teamWithDiscord();
    const channel = snowflake("2");
    const text = `**Released:** [Arm](https://x.test/a)\n${"x".repeat(2500)}`;
    expect((await post(team, { channel, text })).status).toBe(200);
    const pieces = (await sentTo(channel)).map((p) => p.content);
    // Cut at the line break, then at Discord's 2,000 characters.
    expect(pieces).toEqual([
      "**Released:** [Arm](https://x.test/a)",
      "x".repeat(2000),
      "x".repeat(500),
    ]);
    // A Slack channel id isn't the team's.
    expect((await post(team, { channel: "C123", text })).status).toBe(400);
  });

  it("say why a channel refused, and forget a server the bot was removed from", async () => {
    const { team } = await teamWithDiscord();
    const refused = await post(team, { channel: snowflake("3"), text: "Hi" });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ error: "not_in_channel" });
    expect(await discordForTeam(testEnv, team)).not.toBeNull();

    const { team: gone } = await teamWithDiscord(snowflake("4"));
    expect((await post(gone, { channel: snowflake("4"), text: "Hi" })).status).toBe(502);
    expect(await discordForTeam(testEnv, gone)).toBeNull();
  });

  it("DM the team's admins and chosen members who have Discord linked", async () => {
    const { team } = await teamWithDiscord();
    const admin = await memberWithDiscord(team, { isAdmin: true });
    const member = await memberWithDiscord(team);
    const res = await g3id(`/internal/teams/${team}/chat/dm-admins`, {
      method: "POST",
      body: { text: "Pit was switched off." },
    });
    expect(await res.json()).toMatchObject({ sent: 1, admins: 1 });
    expect((await sentTo(`dm-${admin.discordId}`)).at(-1)?.content).toBe("Pit was switched off.");

    const chosen = await g3id(`/internal/teams/${team}/chat/dm-members`, {
      method: "POST",
      body: { userIds: [member.userId], text: "Downtime Saturday." },
    });
    expect(await chosen.json()).toMatchObject({ sent: 1, members: 1 });
    expect((await sentTo(`dm-${member.discordId}`)).at(-1)?.content).toBe("Downtime Saturday.");
  });

  it("list the server's channels, with where the bot can post", async () => {
    const { team } = await teamWithDiscord();
    const admin = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    const res = await g3id("/admin/chat/channels", { cookie: admin });
    expect(await res.json()).toEqual({
      provider: "discord",
      channels: [
        {
          id: DISCORD_CHANNELS.announcements,
          name: "announcements",
          isPrivate: false,
          canPost: true,
        },
        { id: DISCORD_CHANNELS.mentors, name: "mentors", isPrivate: true, canPost: true },
        { id: DISCORD_CHANNELS.shop, name: "shop", isPrivate: false, canPost: false },
      ],
    });
  });
});

describe("the founder's sign-up with Discord", () => {
  const founderSignUp = (team: string, guild: string, user: Record<string, unknown>) =>
    g3id(`/internal/teams/${team}/discord-founder`, {
      method: "POST",
      body: { guild: { id: guild, name: "Robotics" }, user },
    });

  it("connects the server and makes the founder the team's admin, once", async () => {
    const team = await createTeam();
    const guild = snowflake("5");
    const founder = { id: snowflake("5"), displayName: "Fay", email: "fay@discord.test" };
    const res = await founderSignUp(team, guild, founder);
    expect(res.status).toBe(200);
    expect((await discordForTeam(testEnv, team))?.guildId).toBe(guild);
    // The team has a member now: nobody else becomes its founder.
    expect((await founderSignUp(team, guild, founder)).status).toBe(409);
    // Someone without a verified email can't found a team.
    const unverified = { id: snowflake("5"), displayName: "Ned", email: null };
    expect((await founderSignUp(await createTeam(), snowflake("5"), unverified)).status).toBe(409);
  });

  it("hands the session over only on the team's own address", async () => {
    const team = await createTeam();
    const user = { id: snowflake("5"), displayName: "Fay", email: `${snowflake()}@discord.test` };
    const { token } = (await (await founderSignUp(team, snowflake("5"), user)).json()) as {
      token: string;
    };
    const elsewhere = await g3id(`/auth/handoff?token=${token}`, {
      headers: { "X-Team-Id": "frc1" },
      redirect: "manual",
    });
    expect(elsewhere.status).toBe(400);
    // A token tried anywhere is spent.
    const after = await g3id(`/auth/handoff?token=${token}`, {
      headers: { "X-Team-Id": team },
      redirect: "manual",
    });
    expect(after.status).toBe(400);
  });

  it("signs the founder in on the team's own address", async () => {
    const team = await createTeam();
    const founder = snowflake("5");
    const res = await founderSignUp(team, snowflake("5"), {
      id: founder,
      displayName: "Fay",
      email: `${founder}@discord.test`,
    });
    const { token } = (await res.json()) as { token: string };
    const handed = await g3id(`/auth/handoff?token=${token}`, {
      headers: { "X-Team-Id": team },
      redirect: "manual",
    });
    expect(handed.headers.get("Location")).toBe(`${portal(team)}/`);
    expect(cookieFrom(handed)).not.toBeNull();
  });
});
