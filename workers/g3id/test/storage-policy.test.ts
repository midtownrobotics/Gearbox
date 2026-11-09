// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { teamStoragePolicy } from "../src/db/schema";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

const path = "/admin/team/storage-policy";
describe("team-wide storage policy", () => {
  it("defaults to current automatic cleanup without writing on reads", async () => {
    const team = await createTeam();
    const cookie = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
    const response = await g3id(path, { cookie });
    expect(await response.json()).toEqual({ automaticDeletion: true });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(
      await createDb(testEnv.DB)
        .select()
        .from(teamStoragePolicy)
        .where(eq(teamStoragePolicy.teamId, team)),
    ).toHaveLength(0);
  });
  it("requires a non-kiosk admin for reads and writes", async () => {
    const member = await sessionCookie(await createUser());
    const mentor = await sessionCookie(await createUser({ isMentor: true }));
    const pin = await sessionCookie(await createUser({ isAdmin: true }));
    await testEnv.SESSIONS.put(
      `session:${pin.split("=")[1]}:meta`,
      JSON.stringify({ sessionType: "pin" }),
    );
    for (const method of ["GET", "PUT"]) {
      const init = { method, ...(method === "PUT" ? { body: { automaticDeletion: false } } : {}) };
      expect((await g3id(path, init)).status).toBe(401);
      for (const cookie of [member, mentor, pin])
        expect((await g3id(path, { ...init, cookie })).status).toBe(403);
    }
  });
  it("changes only the admin's team, logs actual changes once and validates the choice", async () => {
    const a = await createTeam();
    const b = await createTeam();
    const cookie = await sessionCookie(await createUser({ teamId: a, isAdmin: true }));
    const init = {
      method: "PUT",
      cookie,
      headers: { "X-Team-Id": b },
      body: { automaticDeletion: false, teamId: b },
    };
    expect((await g3id(path, init)).status).toBe(200);
    expect((await g3id(path, init)).status).toBe(200);
    expect(await (await g3id(`/internal/teams/${a}/storage-policy`)).json()).toEqual({
      automaticDeletion: false,
    });
    expect(await (await g3id(`/internal/teams/${b}/storage-policy`)).json()).toEqual({
      automaticDeletion: true,
    });
    expect(
      (await g3id(path, { method: "PUT", cookie, body: { automaticDeletion: "false" } })).status,
    ).toBe(400);
    await expect
      .poll(async () => {
        const response = await (testEnv.PLATFORM as Fetcher).fetch(
          `http://platform/api/internal/teams/${a}/audit`,
        );
        return response.json();
      })
      .toEqual([
        {
          userId: expect.any(String),
          app: "id",
          what: "Storage policy",
          changed: ["Automatic file deletion"],
        },
      ]);
    expect((await g3id(`/internal/teams/${a}`, { method: "DELETE" })).status).toBe(200);
    expect(
      await createDb(testEnv.DB)
        .select()
        .from(teamStoragePolicy)
        .where(eq(teamStoragePolicy.teamId, a)),
    ).toHaveLength(0);
    expect(await (await g3id(`/internal/teams/${b}/storage-policy`)).json()).toEqual({
      automaticDeletion: true,
    });
  });
});
