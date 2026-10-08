import {
  type TeamUiSettings,
  brandColor,
  builtInBrandColor,
  defaultAppOrder,
  defaultTeamUiSettings,
  hexToHsv,
  hsvToHex,
  teamKey,
  teamLinks,
  teamUiDefaults,
  toolLinks,
  withHueOf,
} from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { teamUiSettings } from "../src/db/schema";
import { readTeamUiSettings } from "../src/lib/team-ui";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

/** What pages are sent: the settings, and the brand colour for pages loaded before it was the accent. */
const served = (settings: TeamUiSettings) => ({
  ...settings,
  primaryColor: brandColor(settings),
});

describe("team UI settings", () => {
  it("serves current team defaults publicly", async () => {
    const response = await g3id("/team/ui");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(served(defaultTeamUiSettings));
    // The default accent keeps the built-in palette and icons.
    expect(brandColor(defaultTeamUiSettings)).toBe(builtInBrandColor);
  });

  it("only lets an active admin save them, and reflects the saved settings", async () => {
    const member = await sessionCookie(await createUser());
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const settings = {
      ...defaultTeamUiSettings,
      name: "Changed team",
      shortName: "Changed",
      linkAccents: false,
      light: { ...defaultTeamUiSettings.light, accent: "#123456" },
      links: { ...defaultTeamUiSettings.links, github: "https://github.com/example" },
    };
    const put = (cookie?: string) =>
      g3id("/admin/team/ui", { method: "PUT", cookie, body: settings });
    expect((await put()).status).toBe(401);
    expect((await put(member)).status).toBe(403);
    expect((await put(admin)).status).toBe(200);
    // Pages get the light accent as the brand colour, too.
    expect(await (await g3id("/team/ui")).json()).toEqual({ ...settings, primaryColor: "#123456" });
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
      { ...base, light: { ...base.light, accent: "red" } },
      { ...base, dark: { ...base.dark, accent: "#12345" } },
      { ...base, linkAccents: "yes" },
      // The brand colour is the light accent now: an editor from before can't save its own.
      { ...base, primaryColor: "#123456" },
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

  it("gives a team that hasn't saved any its own name, number and links, not the site team's", async () => {
    const otherTeam = await createTeam();
    const number = Number(otherTeam.slice(3));
    const theirs = (await (
      await g3id("/team/ui", { headers: { "X-Team-Id": otherTeam } })
    ).json()) as typeof defaultTeamUiSettings;
    expect(theirs).toMatchObject({
      name: "Other Team",
      shortName: String(number),
      links: {
        publicSite: "",
        slack: "",
        blueAlliance: `https://www.thebluealliance.com/team/${number}`,
      },
    });
    const defaults = teamUiDefaults(otherTeam, "Other Team");
    expect(theirs).toEqual(served(defaults));

    // Their editor resets to these defaults, too.
    const theirAdmin = await sessionCookie(await createUser({ teamId: otherTeam, isAdmin: true }));
    expect(await (await g3id("/admin/team/ui", { cookie: theirAdmin })).json()).toMatchObject({
      settings: defaults,
      defaults,
    });
  });

  it("keeps each team's appearance to itself", async () => {
    const otherTeam = await createTeam();
    const theirAdmin = await sessionCookie(await createUser({ teamId: otherTeam, isAdmin: true }));
    const ours = await (await g3id("/team/ui")).json();
    const theirs = {
      ...defaultTeamUiSettings,
      name: "Their team",
      light: { ...defaultTeamUiSettings.light, accent: "#654321" },
    };
    expect(
      (await g3id("/admin/team/ui", { method: "PUT", cookie: theirAdmin, body: theirs })).status,
    ).toBe(200);
    // Their pages (the gateway's X-Team-Id) get theirs; ours are unchanged.
    expect(await (await g3id("/team/ui", { headers: { "X-Team-Id": otherTeam } })).json()).toEqual(
      served(theirs),
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
      dark: { ...defaultTeamUiSettings.dark, accent: "#112233" },
      hiddenLinks: ["blueAlliance", "publicSite"] as TeamUiSettings["hiddenLinks"],
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
    expect(await (await g3id("/team/ui")).json()).toEqual(served(settings));
    expect(
      (await g3id("/admin/team/ui", { method: "PUT", cookie: admin, body: defaultTeamUiSettings }))
        .status,
    ).toBe(200);
    expect(await (await g3id("/team/ui")).json()).toEqual(served(defaultTeamUiSettings));
  });

  it("adds new links to older stored settings without resetting branding or restoring removed links", async () => {
    const {
      hiddenLinks: _hidden,
      linkAccents: _linked,
      links,
      ...appearance
    } = defaultTeamUiSettings;
    const legacy = {
      ...appearance,
      name: "Existing team",
      light: { ...appearance.light, text: "#abcdef", accent: "#0a7d55" },
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
    const current = {
      ...legacy,
      linkAccents: true,
      links: { ...legacy.links, ...teamLinks, ...toolLinks },
      hiddenLinks: [],
      appOrder: defaultAppOrder,
    };
    expect(await (await g3id("/team/ui")).json()).toEqual({ ...current, primaryColor: "#0a7d55" });
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    expect(await (await g3id("/admin/team/ui", { cookie: admin })).json()).toMatchObject({
      settings: current,
    });
  });

  it("keeps each team's order for the apps grid, and fills in tiles a saved order is missing", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const reordered = [...defaultAppOrder].reverse();
    const put = (appOrder: unknown) =>
      g3id("/admin/team/ui", {
        method: "PUT",
        cookie: admin,
        body: { ...defaultTeamUiSettings, appOrder },
      });
    expect((await put(reordered)).status).toBe(200);
    expect(((await (await g3id("/team/ui")).json()) as { appOrder: string[] }).appOrder).toEqual(
      reordered,
    );
    // Every tile once: none missing, none twice, nothing unknown.
    expect((await put(reordered.slice(1))).status).toBe(400);
    expect((await put([...reordered, reordered[0]])).status).toBe(400);
    expect((await put([...reordered.slice(1), "nope"])).status).toBe(400);
    // Saved before a tile existed: it's added in its default place, after the saved ones.
    const older = readTeamUiSettings(
      JSON.stringify({ ...defaultTeamUiSettings, appOrder: ["edge", "shop"] }),
    );
    expect(older.appOrder.slice(0, 2)).toEqual(["edge", "shop"]);
    expect(older.appOrder).toHaveLength(defaultAppOrder.length);
    expect((await put(defaultAppOrder)).status).toBe(200);
  });

  describe("settings saved when the brand colour was its own setting", () => {
    const { linkAccents: _linked, ...appearance } = defaultTeamUiSettings;
    const read = (legacy: object) => readTeamUiSettings(JSON.stringify(legacy));

    it("makes a chosen brand colour the light accent, and gives an unchosen dark accent its hue", () => {
      const settings = read({ ...appearance, primaryColor: "#0b5fa5" });
      expect(settings).toEqual({
        ...defaultTeamUiSettings,
        light: { ...defaultTeamUiSettings.light, accent: "#0b5fa5" },
        // The default dark accent, turned to #0b5fa5's hue.
        dark: { ...defaultTeamUiSettings.dark, accent: "#67ade8" },
      });
      // So buttons, links and icons stay the colour the team chose.
      expect(brandColor(settings)).toBe("#0b5fa5");
    });

    it("keeps a dark accent the team chose", () => {
      const dark = { ...appearance.dark, accent: "#ffcc00" };
      expect(read({ ...appearance, primaryColor: "#123456", dark })).toEqual({
        ...defaultTeamUiSettings,
        light: { ...defaultTeamUiSettings.light, accent: "#123456" },
        dark,
      });
    });

    it("keeps the accents as saved when the brand colour was the built-in one", () => {
      const light = { ...appearance.light, accent: "#0a7d55" };
      expect(read({ ...appearance, primaryColor: builtInBrandColor })).toEqual(
        defaultTeamUiSettings,
      );
      expect(read({ ...appearance, primaryColor: "#A32035", light })).toEqual({
        ...defaultTeamUiSettings,
        light,
      });
    });
  });
});

describe("accent colours", () => {
  it("reads a colour's hue, saturation and value, and writes it back", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#008000")).toEqual({ h: 120, s: 1, v: 128 / 255 });
    expect(hexToHsv("#808080")).toEqual({ h: 0, s: 0, v: 128 / 255 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
    expect(hsvToHex({ h: 360, s: 0.5, v: 1 })).toBe("#ff8080");
    for (const hex of [
      "#a71433",
      "#e8677c",
      "#123456",
      "#0a7d55",
      "#ffcc00",
      "#fefefe",
      "#010203",
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("turns one colour to another's hue, keeping its own saturation and value", () => {
    expect(withHueOf("#bf4040", "#0000ff")).toBe("#4040bf");
    expect(withHueOf("#e8677c", "#0b5fa5")).toBe("#67ade8");
    const before = hexToHsv("#e8677c");
    const linked = hexToHsv(withHueOf("#e8677c", "#1d4ed8"));
    expect(linked.s).toBe(before.s);
    expect(linked.v).toBe(before.v);
    expect(linked.h).toBeCloseTo(hexToHsv("#1d4ed8").h, 0);
    // A grey stays a grey whatever hue it's given, and has none to give.
    expect(withHueOf("#808080", "#ff0000")).toBe("#808080");
    expect(withHueOf("#a71433", "#777777")).toBe("#a71433");
    expect(withHueOf("#A71433", "#000000")).toBe("#a71433");
  });
});
