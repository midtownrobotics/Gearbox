import { defaultTeamUiSettings, teamKey, teamLinks } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { teamUiSettings } from "../src/db/schema";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

describe("team UI settings", () => {
  it("serves current team defaults publicly", async () => {
    const response = await g3id("/team/ui");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(defaultTeamUiSettings);
  });

  it("only lets an active admin save them, and reflects the saved settings", async () => {
    const member = await sessionCookie(await createUser());
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const settings = {
      ...defaultTeamUiSettings,
      name: "Changed team",
      shortName: "Changed",
      primaryColor: "#123456",
      links: { ...defaultTeamUiSettings.links, github: "https://github.com/example" },
    };
    const put = (cookie?: string) =>
      g3id("/admin/team/ui", { method: "PUT", cookie, body: settings });
    expect((await put()).status).toBe(401);
    expect((await put(member)).status).toBe(403);
    expect((await put(admin)).status).toBe(200);
    expect(await (await g3id("/team/ui")).json()).toEqual(settings);
    expect(await (await g3id("/admin/team/ui", { cookie: admin })).json()).toMatchObject({
      settings,
      updatedAt: expect.any(Number),
    });
  });

  it("rejects invalid colors, unsafe links, and unknown fields without changing data", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const before = await (await g3id("/team/ui")).json();
    const base = { ...defaultTeamUiSettings, shortName: "Good" };
    for (const invalid of [
      { ...base, primaryColor: "red" },
      { ...base, links: { ...base.links, github: "javascript:alert(1)" } },
      { ...base, unexpected: true },
      { ...base, links: { ...base.links, frcEvents: "javascript:alert(1)" } },
      { ...base, hiddenLinks: ["unknown"] },
      { ...base, hiddenLinks: ["github", "github"] },
    ]) {
      expect(
        (await g3id("/admin/team/ui", { method: "PUT", cookie: admin, body: invalid })).status,
      ).toBe(400);
    }
    expect(await (await g3id("/team/ui")).json()).toEqual(before);
  });

  it("never reads another team's settings", async () => {
    const before = await (await g3id("/team/ui")).json();
    await createDb(testEnv.DB)
      .insert(teamUiSettings)
      .values({
        teamId: "frc9999",
        settingsJson: JSON.stringify({ ...defaultTeamUiSettings, name: "Other team" }),
        updatedAt: Math.floor(Date.now() / 1000),
      });
    expect(await (await g3id("/team/ui")).json()).toEqual(before);
  });

  it("keeps each team's appearance to itself", async () => {
    const otherTeam = await createTeam();
    const theirAdmin = await sessionCookie(await createUser({ teamId: otherTeam, isAdmin: true }));
    const ours = await (await g3id("/team/ui")).json();
    const theirs = { ...defaultTeamUiSettings, name: "Their team", primaryColor: "#654321" };
    expect(
      (await g3id("/admin/team/ui", { method: "PUT", cookie: theirAdmin, body: theirs })).status,
    ).toBe(200);
    // Their pages (the gateway's X-Team-Id) get theirs; ours are unchanged.
    expect(await (await g3id("/team/ui", { headers: { "X-Team-Id": otherTeam } })).json()).toEqual(
      theirs,
    );
    expect(await (await g3id("/team/ui")).json()).toEqual(ours);
    expect(await (await g3id("/admin/team/ui", { cookie: theirAdmin })).json()).toMatchObject({
      settings: theirs,
    });
  });

  it("saves new portal URLs, preserves hidden URLs, accepts removed links, and restores all defaults", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const settings = {
      ...defaultTeamUiSettings,
      primaryColor: "#112233",
      hiddenLinks: ["blueAlliance", "publicSite"],
      links: {
        ...defaultTeamUiSettings.links,
        frcEvents: "https://frc-events.firstinspires.org/team/254",
        blueAlliance: "https://www.thebluealliance.com/team/254",
        statbotics: "https://www.statbotics.io/team/254",
        match13: "",
      },
    };
    expect(
      (await g3id("/admin/team/ui", { method: "PUT", cookie: admin, body: settings })).status,
    ).toBe(200);
    expect(await (await g3id("/team/ui")).json()).toEqual(settings);
    expect(
      (await g3id("/admin/team/ui", { method: "PUT", cookie: admin, body: defaultTeamUiSettings }))
        .status,
    ).toBe(200);
    expect(await (await g3id("/team/ui")).json()).toEqual(defaultTeamUiSettings);
  });

  it("adds new links to older stored settings without resetting branding or restoring removed links", async () => {
    const { hiddenLinks: _hidden, links, ...appearance } = defaultTeamUiSettings;
    const legacy = {
      ...appearance,
      name: "Existing team",
      primaryColor: "#123456",
      light: { ...appearance.light, text: "#abcdef" },
      links: {
        publicSite: links.publicSite,
        slack: links.slack,
        github: "",
        instagram: links.instagram,
      },
    };
    await createDb(testEnv.DB)
      .insert(teamUiSettings)
      .values({
        teamId: teamKey,
        settingsJson: JSON.stringify(legacy),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .onConflictDoUpdate({
        target: teamUiSettings.teamId,
        set: { settingsJson: JSON.stringify(legacy) },
      });
    expect(await (await g3id("/team/ui")).json()).toEqual({
      ...legacy,
      links: { ...legacy.links, ...teamLinks },
      hiddenLinks: [],
    });
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    expect(await (await g3id("/admin/team/ui", { cookie: admin })).json()).toMatchObject({
      settings: { ...legacy, links: { ...legacy.links, ...teamLinks }, hiddenLinks: [] },
    });
  });
});
