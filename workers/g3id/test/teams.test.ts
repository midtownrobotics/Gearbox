import { site, teamKey } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { currentTeamId } from "../src/lib/team";
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
    expect(currentTeamId()).toBe(teamKey);

    const userId = await createUser();
    const user = await one<{ team_id: string }>(
      "SELECT team_id FROM core_users WHERE id = ?",
      userId,
    );
    expect(user?.team_id).toBe(team?.id);
  });

  it("gives Slack sign-in codes the site's team and link codes the user's team", async () => {
    await g3id("/auth/slack/initiate");
    const signin = await one<{ team_id: string }>(
      "SELECT team_id FROM core_slack_link_codes WHERE type = 'signin' ORDER BY created_at DESC LIMIT 1",
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
