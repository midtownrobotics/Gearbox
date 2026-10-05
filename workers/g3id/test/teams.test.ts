import { site, teamKey } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { siteTeamId } from "../src/lib/team";
import {
  activateKiosk,
  cookieFrom,
  createTeam,
  createUser,
  createUserWithPin,
  g3id,
  sessionCookie,
  testEnv,
} from "./helpers";

// Every account belongs to one team (roadmap 2.1). Until the gateway reads the team from the
// hostname, requests are for the team in site.ts; kiosks and PINs keep teams apart already.

const one = <T>(sql: string, ...binds: unknown[]) =>
  testEnv.DB.prepare(sql)
    .bind(...binds)
    .first<T>();

describe("teams", () => {
  it("has the site's team, which new accounts join", async () => {
    const team = await one<{ id: string; team_number: number }>(
      "SELECT id, team_number FROM teams WHERE id = ?",
      teamKey,
    );
    expect(team?.team_number).toBe(site.team.number);
    expect(siteTeamId).toBe(teamKey);

    const userId = await createUser();
    const user = await one<{ team_id: string }>(
      "SELECT team_id FROM core_users WHERE id = ?",
      userId,
    );
    expect(user?.team_id).toBe(team?.id);
  });

  it("gives Slack sign-in codes the site's team and link codes the user's team", async () => {
    const initiate = await g3id("/auth/slack/initiate", { redirect: "manual" });
    const token = new URL(initiate.headers.get("Location") as string).searchParams.get("token");
    const signin = await one<{ team_id: string }>(
      "SELECT team_id FROM core_slack_link_codes WHERE polling_token = ?",
      token,
    );
    expect(signin?.team_id).toBe(teamKey);

    const otherTeam = await createTeam();
    const userId = await createUser({ teamId: otherTeam });
    const res = await g3id("/auth/slack/link", { cookie: await sessionCookie(userId) });
    const { code } = (await res.json()) as { code: string };
    const link = await one<{ team_id: string }>(
      "SELECT team_id FROM core_slack_link_codes WHERE code = ?",
      code,
    );
    expect(link?.team_id).toBe(otherTeam);
  });
});

describe("kiosks and PINs per team", () => {
  const signInWithPin = (pin: string, kioskToken: string) =>
    g3id("/auth/pin", { method: "POST", kioskToken, body: { pin } });

  it("puts a kiosk in the team of the admin who activated it", async () => {
    const otherTeam = await createTeam();
    const admin = await sessionCookie(await createUser({ isAdmin: true, teamId: otherTeam }));
    const token = await activateKiosk(admin, "Other kiosk");
    const device = await one<{ team_id: string }>(
      "SELECT team_id FROM kiosk_devices WHERE token = ?",
      token,
    );
    expect(device?.team_id).toBe(otherTeam);
  });

  it("lets two teams use the same PIN, and signs each kiosk into its own team", async () => {
    const otherTeam = await createTeam();
    const ours = await createUserWithPin();
    const theirs = await createUserWithPin({ teamId: otherTeam });
    // Give their member our member's PIN: allowed, because PINs are unique only within a team.
    await testEnv.DB.prepare("UPDATE core_user_pins SET pin = ? WHERE user_id = ?")
      .bind(ours.pin, theirs.id)
      .run();

    const ourKiosk = await activateKiosk(await sessionCookie(await createUser({ isAdmin: true })));
    const theirKiosk = await activateKiosk(
      await sessionCookie(await createUser({ isAdmin: true, teamId: otherTeam })),
    );

    for (const [kiosk, expected] of [
      [ourKiosk, ours.id],
      [theirKiosk, theirs.id],
    ]) {
      const res = await signInWithPin(ours.pin, kiosk);
      expect(res.status).toBe(200);
      const me = await g3id("/auth/me", { cookie: cookieFrom(res) as string });
      expect(await me.json()).toMatchObject({ id: expected });
    }
  });

  it("doesn't sign in another team's member", async () => {
    const otherTeam = await createTeam();
    const theirs = await createUserWithPin({ teamId: otherTeam });
    await testEnv.DB.prepare("DELETE FROM core_user_pins WHERE team_id != ? AND pin = ?")
      .bind(otherTeam, theirs.pin)
      .run();
    const ourKiosk = await activateKiosk(await sessionCookie(await createUser({ isAdmin: true })));
    expect((await signInWithPin(theirs.pin, ourKiosk)).status).toBe(400);
  });
});

describe("team lookups", () => {
  it("answers whether a team exists, for the gateway", async () => {
    const res = await g3id(`/teams/${teamKey}`);
    expect(await res.json()).toEqual({
      id: teamKey,
      teamNumber: site.team.number,
      name: site.team.name,
    });
    expect((await g3id("/teams/frc999999")).status).toBe(404);
  });

  it("reports the signed-in user's team", async () => {
    const otherTeam = await createTeam();
    const cookie = await sessionCookie(await createUser({ teamId: otherTeam }));
    expect(await (await g3id("/auth/me", { cookie })).json()).toMatchObject({ teamId: otherTeam });
  });
});

describe("looking up a member by PIN", () => {
  it("only finds members of the caller's own team", async () => {
    const otherTeam = await createTeam();
    const theirs = await createUserWithPin({ teamId: otherTeam });
    await testEnv.DB.prepare("DELETE FROM core_user_pins WHERE team_id != ? AND pin = ?")
      .bind(otherTeam, theirs.pin)
      .run();
    const ours = await sessionCookie(await createUser());
    const colleague = await sessionCookie(await createUser({ teamId: otherTeam }));

    expect((await g3id(`/users/by-pin/${theirs.pin}`, { cookie: ours })).status).toBe(404);
    const found = await g3id(`/users/by-pin/${theirs.pin}`, { cookie: colleague });
    expect(await found.json()).toMatchObject({ id: theirs.id });
  });
});

describe("signing in to a team", () => {
  const asTeam = (team: string, path: string, init: Parameters<typeof g3id>[1] = {}) =>
    // "manual": see the sign-in's redirect instead of following it back into the worker.
    g3id(path, { redirect: "manual", ...init, headers: { "X-Team-Id": team, ...init.headers } });

  it("tells the sign-in page which team it's for", async () => {
    const otherTeam = await createTeam();
    expect(await (await asTeam(otherTeam, "/teams/current")).json()).toMatchObject({
      id: otherTeam,
    });
    expect(await (await g3id("/teams/current")).json()).toMatchObject({ id: teamKey });
  });

  it("signs a member in by email only on their own team's address", async () => {
    const otherTeam = await createTeam();
    const email = `${crypto.randomUUID()}@test.g3`;
    await createUser({ teamId: otherTeam, email, password: "correct-horse" });
    const login = (team: string) =>
      asTeam(team, "/auth/login/email", {
        method: "POST",
        body: { email, password: "correct-horse" },
      });

    expect((await login(teamKey)).status).toBe(403);
    const ok = await login(otherTeam);
    expect(ok.status).toBe(200);
    expect(cookieFrom(ok)).not.toBeNull();
  });

  it("starts a Slack sign-in for the address's team and sends it back there", async () => {
    const otherTeam = await createTeam();
    const number = otherTeam.slice(3);
    const res = await asTeam(otherTeam, "/auth/slack/initiate?redirect=https://evil.example/");
    expect(res.headers.get("Location")).toMatch(
      new RegExp(
        `^https://${number}-id\\.${site.platformDomain.replace(".", "\\.")}/login/slack\\?`,
      ),
    );
    const token = new URL(res.headers.get("Location") as string).searchParams.get("token");
    const code = await one<{ team_id: string; redirect_url: string | null }>(
      "SELECT team_id, redirect_url FROM core_slack_link_codes WHERE polling_token = ?",
      token,
    );
    // The team's code, and no redirect to a page outside the team.
    expect(code).toEqual({ team_id: otherTeam, redirect_url: null });
  });

  it("keeps the team and return address in a provider sign-in's state", async () => {
    const otherTeam = await createTeam();
    const back = `https://${otherTeam.slice(3)}-orders.${site.platformDomain}/`;
    const res = await asTeam(otherTeam, `/auth/google?redirect=${encodeURIComponent(back)}`);
    const google = new URL(res.headers.get("Location") as string);
    // Back on the platform's id host, so the session cookie lands on the team's domain.
    expect(google.searchParams.get("redirect_uri")).toBe(
      `https://id.${site.platformDomain}/api/auth/google/callback`,
    );
    const state = await testEnv.RATE_LIMIT.get(`oauth_state:${google.searchParams.get("state")}`);
    expect(JSON.parse(state as string)).toEqual({
      team: otherTeam,
      redirect: back,
      linkUserId: null,
    });
  });

  it("only lets a sign-in return to its own team's pages", async () => {
    const otherTeam = await createTeam();
    const number = otherTeam.slice(3);
    const ours = `https://orders.${site.domain}/lists`;
    const theirs = `https://${number}-orders.${site.platformDomain}/lists`;
    const redirectOf = async (team: string, redirect: string) => {
      const res = await asTeam(
        team,
        `/auth/slack/initiate?redirect=${encodeURIComponent(redirect)}`,
      );
      const token = new URL(res.headers.get("Location") as string).searchParams.get("token");
      return (
        await one<{ redirect_url: string | null }>(
          "SELECT redirect_url FROM core_slack_link_codes WHERE polling_token = ?",
          token,
        )
      )?.redirect_url;
    };
    expect(await redirectOf(otherTeam, theirs)).toBe(theirs);
    expect(await redirectOf(otherTeam, ours)).toBeNull();
    expect(await redirectOf(teamKey, ours)).toBe(ours);
    expect(await redirectOf(teamKey, theirs)).toBeNull();
  });
});
