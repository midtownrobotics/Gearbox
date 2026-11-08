// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("team Storage page API", () => {
  it("requires an admin, including for file downloads", async () => {
    const users = teamUsers(newTeamId());
    for (const path of [
      "/api/team/storage",
      "/api/team/storage/shop/download?key=test",
      "/api/team/storage/shop/archive",
    ]) {
      expect((await call(path)).status).toBe(401);
      expect((await callAs(users.student, path)).status).toBe(403);
      expect((await callAs(users.mentor, path)).status).toBe(403);
      expect((await callAs({ ...users.admin, sessionType: "pin" }, path)).status).toBe(403);
    }
  });

  it("shows only the signed-in team's storage, including retained files with apps off", async () => {
    const team = newTeamId();
    const users = teamUsers(team);
    const response = await callAs(users.admin, "/api/team/storage");
    expect(response.status).toBe(200);
    const body = await response.json<{ apps: { slug: string; report: unknown }[] }>();
    expect(body.apps.map((app) => app.slug).sort()).toEqual(["pit", "scouting", "shop"]);
    expect(JSON.stringify(body)).toContain(`teams/${team}/test`);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const file = await callAs(
      users.admin,
      `/api/team/storage/shop/download?key=${encodeURIComponent(`teams/${team}/test`)}`,
    );
    expect(await file.text()).toBe(team);
    expect(file.headers.get("Content-Disposition")).toContain("attachment");
    expect(
      (
        await callAs(
          users.admin,
          `/api/team/storage/shop/download?key=${encodeURIComponent(`teams/${newTeamId()}/test`)}`,
        )
      ).status,
    ).toBe(404);
    expect((await callAs(users.admin, "/api/team/storage/edge/archive")).status).toBe(404);
  });

  it("marks unavailable usage as unknown rather than reporting an empty allowance", async () => {
    const team = newTeamId();
    const users = teamUsers(team);
    // Stub control is reached through its service binding, as existing app-library tests do.
    await (env as unknown as { SHOP: Fetcher }).SHOP.fetch(
      `http://shop/api/internal/fail/${team}`,
      { method: "POST" },
    );
    const response = await callAs(users.admin, "/api/team/storage");
    const body = await response.json<{
      apps: { slug: string; report: unknown; error: string | null }[];
    }>();
    expect(body.apps.find((app) => app.slug === "shop")).toMatchObject({
      report: null,
      error: expect.any(String),
    });
    expect(body.apps.find((app) => app.slug === "pit")?.report).not.toBeNull();
  });
});
