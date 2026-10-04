import { defaultTeamUiSettings } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { teamUiSettings } from "../src/db/schema";
import { testEnv } from "./helpers";
import { createUser, g3id, sessionCookie } from "./helpers";

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
});
