import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { teamKey } from "@g3/site-config";
import { type TestUser, asUser, teamUsers } from "@g3/testing/users";
import { describe, expect, it } from "vitest";
import { clearSwitchedOff } from "../src/team";
import type { AppEnv } from "../src/types";

// A team's apps (roadmap 4.2 to 4.4): switching them on and off from the team's admin pages,
// what the gateway and the team's home are told, and the daily clean-up of switched-off apps.
// The apps' hooks are stubs that record what they were asked (vitest.config.mts).

const testEnv = env as unknown as AppEnv["Bindings"];

/** A new active team with no apps on, as sign-up leaves one, and its users. */
async function newTeam() {
  const number = 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000);
  const id = `frc${number}`;
  await testEnv.PLATFORM_DB.prepare(
    `INSERT INTO teams (id, team_number, name, country, status, created_at, updated_at)
     VALUES (?1, ?2, 'A Team', 'US', 'active', 1, 1)`,
  )
    .bind(id, number)
    .run();
  return teamUsers(id);
}

function call(user: TestUser | null, path: string, init: { method?: string; body?: unknown } = {}) {
  const options = user ? asUser(user, init) : { ...init, body: undefined };
  return exports.default.fetch(new Request(`http://platform/api${path}`, options));
}

async function json<T>(user: TestUser | null, path: string, init = {}): Promise<T> {
  const res = await call(user, path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type LibraryApp = {
  slug: string;
  enabled: boolean;
  deleteAfter: number | null;
  dataDeleted: boolean;
  keepsDataWhenOff: boolean;
};

const switchApp = (user: TestUser, slug: string, enabled: boolean) =>
  call(user, `/team/library/${slug}`, { method: "PUT", body: { enabled } });

const teamApps = async (teamId: string) =>
  ((await json<{ apps: string[] }>(null, `/teams/${teamId}`)).apps ?? []).sort();

const stubbed = async (binding: "ORDERS" | "SHOP" | "SKILL_TREE", what: "seeded" | "deleted") =>
  (await (await testEnv[binding].fetch(`http://app/api/internal/${what}`)).json()) as string[];

describe("a new team", () => {
  it("starts with only sign-in and its home", async () => {
    const team = await newTeam();
    expect(await teamApps(team.teamId)).toEqual(["id", "portal"]);
    const home = await json<{ apps: { slug: string }[] }>(team.student, "/team/apps");
    expect(home.apps.map((a) => a.slug)).toEqual(["id", "portal"]);
  });

  it("can't switch on Scouting, which isn't kept per team yet; the site's team can", async () => {
    const team = await newTeam();
    const library = await json<LibraryApp[]>(team.admin, "/team/library");
    expect(library.map((a) => a.slug)).not.toContain("scouting");
    expect(library.map((a) => a.slug)).not.toContain("id");
    expect((await switchApp(team.admin, "scouting", true)).status).toBe(404);
    const site = await json<LibraryApp[]>(teamUsers(teamKey).admin, "/team/library");
    expect(site.map((a) => a.slug)).toContain("scouting");
  });
});

describe("switching an app on", () => {
  it("shows it to the gateway and the home, and runs its seed hook", async () => {
    const team = await newTeam();
    const res = await switchApp(team.admin, "orders", true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seeded: true });
    expect(await teamApps(team.teamId)).toEqual(["id", "orders", "portal"]);
    expect(await stubbed("ORDERS", "seeded")).toContain(team.teamId);
    // Shop has no seed hook.
    await switchApp(team.admin, "shop", true);
    expect(await stubbed("SHOP", "seeded")).not.toContain(team.teamId);
  });

  it("is for the team's admins only, never a kiosk", async () => {
    const team = await newTeam();
    for (const user of [team.student, team.mentor, team.kioskAdmin]) {
      expect((await switchApp(user, "orders", true)).status).toBe(403);
      expect((await call(user, "/team/library")).status).toBe(403);
      expect((await call(user, "/team/log")).status).toBe(403);
    }
    expect((await call(null, "/team/apps")).status).toBe(401);
    expect(await teamApps(team.teamId)).toEqual(["id", "portal"]);
  });

  it("only changes the admin's own team", async () => {
    const a = await newTeam();
    const b = await newTeam();
    await switchApp(a.admin, "pit", true);
    expect(await teamApps(b.teamId)).toEqual(["id", "portal"]);
    // A's admin on B's address is signed out there.
    const options = asUser(a.admin, { method: "PUT", body: { enabled: true } });
    const headers = new Headers(options.headers);
    headers.set("X-Team-Id", b.teamId);
    const res = await exports.default.fetch(
      new Request("http://platform/api/team/library/pit", { ...options, headers }),
    );
    expect(res.status).toBe(401);
    expect(await teamApps(b.teamId)).toEqual(["id", "portal"]);
  });
});

describe("switching an app off", () => {
  it("hides it at once and keeps its data for 90 days, then the cron deletes it", async () => {
    const team = await newTeam();
    await switchApp(team.admin, "skillTree", true);
    const res = await switchApp(team.admin, "skillTree", false);
    expect(res.status).toBe(200);
    expect(await teamApps(team.teamId)).toEqual(["id", "portal"]);
    const off = (await json<LibraryApp[]>(team.admin, "/team/library")).find(
      (a) => a.slug === "skillTree",
    );
    const day = 24 * 60 * 60;
    expect(off?.deleteAfter).toBeGreaterThan(Date.now() / 1000 + 89 * day);

    // Not yet due: nothing is deleted.
    await clearSwitchedOff(testEnv);
    expect(await stubbed("SKILL_TREE", "deleted")).not.toContain(team.teamId);

    // Due.
    await testEnv.PLATFORM_DB.prepare(
      "UPDATE team_apps SET delete_after = 1 WHERE team_id = ? AND app = 'skillTree'",
    )
      .bind(team.teamId)
      .run();
    await clearSwitchedOff(testEnv);
    expect(await stubbed("SKILL_TREE", "deleted")).toContain(team.teamId);
    const cleared = (await json<LibraryApp[]>(team.admin, "/team/library")).find(
      (a) => a.slug === "skillTree",
    );
    expect(cleared).toMatchObject({ enabled: false, dataDeleted: true, deleteAfter: null });

    const log = await json<{ action: string; app: string }[]>(team.admin, "/team/log");
    expect(log.map((l) => l.action)).toEqual(["app_data_deleted", "app_disabled", "app_enabled"]);
  });

  it("brings everything back when switched on again within the grace period", async () => {
    const team = await newTeam();
    await switchApp(team.admin, "orders", true);
    await switchApp(team.admin, "orders", false);
    await switchApp(team.admin, "orders", true);
    const log = await json<{ action: string; details: Record<string, unknown> }[]>(
      team.admin,
      "/team/log",
    );
    expect(log[0]).toMatchObject({ action: "app_enabled", details: { restored: true } });
    await testEnv.PLATFORM_DB.prepare(
      "UPDATE team_apps SET delete_after = 1 WHERE team_id = ? AND app = 'orders'",
    )
      .bind(team.teamId)
      .run();
    // It's on: the cron leaves it alone even with an old date.
    await clearSwitchedOff(testEnv);
    expect(await stubbed("ORDERS", "deleted")).not.toContain(team.teamId);
  });

  it("tries again the next day when the app can't delete", async () => {
    const team = await newTeam();
    await switchApp(team.admin, "shop", true);
    await switchApp(team.admin, "shop", false);
    await testEnv.SHOP.fetch(`http://app/api/internal/fail/${team.teamId}`, { method: "POST" });
    await testEnv.PLATFORM_DB.prepare(
      "UPDATE team_apps SET delete_after = 1 WHERE team_id = ? AND app = 'shop'",
    )
      .bind(team.teamId)
      .run();
    await clearSwitchedOff(testEnv);
    const shop = (await json<LibraryApp[]>(team.admin, "/team/library")).find(
      (a) => a.slug === "shop",
    );
    expect(shop).toMatchObject({ dataDeleted: false });
    expect(shop?.deleteAfter).toBe(1);
  });
});

describe("teams from before the library", () => {
  it("keep every app (migration 0005)", async () => {
    const apps = await teamApps(teamKey);
    for (const app of ["orders", "shop", "pit", "edge", "scouting", "skillTree", "attendance"]) {
      expect(apps).toContain(app);
    }
  });
});
