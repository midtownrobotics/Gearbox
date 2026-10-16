import { env } from "cloudflare:test";
import { kioskAdmin, mentor, newTeamId, student, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS } from "../src/downloaders";

// Pairing a pit log downloader: a mentor or admin gets a code on the Logs page, the downloader
// trades it on the team's address for a key of its own, and that key opens /downloader/*.

const database = (env as unknown as { PIT_DB: D1Database }).PIT_DB;

/** What the downloader sends: no session, the team from the address (the gateway's header). */
function pair(teamId: string, body: unknown) {
  return call("/downloaders/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Team-Id": teamId },
    body: JSON.stringify(body),
  });
}

function asDownloader(teamId: string, key: string, init: RequestInit = {}) {
  return {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "X-Team-Id": teamId },
  };
}

async function newCode(user = mentor) {
  return jsonAs<{ code: string; expiresAt: number }>(
    user,
    "/downloaders/codes",
    { method: "POST" },
    201,
  );
}

describe("pairing codes", () => {
  it("are only for mentors and admins, never students or kiosks", async () => {
    expect((await callAs(student, "/downloaders/codes", { method: "POST" })).status).toBe(403);
    expect((await callAs(kioskAdmin, "/downloaders/codes", { method: "POST" })).status).toBe(403);
    const { code, expiresAt } = await newCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it("pair once, and a new code replaces the one before", async () => {
    const team = mentor.teamId;
    const first = await newCode();
    const second = await newCode();
    expect((await pair(team, { code: first.code, name: "Old" })).status).toBe(400);
    const res = await pair(team, { code: second.code, name: "Pit laptop" });
    expect(res.status).toBe(201);
    const paired = (await res.json()) as { id: number; key: string; name: string };
    expect(paired.key).toMatch(/^pld_/);
    expect(paired.name).toBe("Pit laptop");
    expect((await pair(team, { code: second.code, name: "Again" })).status).toBe(400);
  });

  it("stop working after too many wrong codes", async () => {
    const team = mentor.teamId;
    const { code } = await newCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await pair(team, { code: wrong, name: "Guess" })).status).toBe(400);
    }
    expect((await pair(team, { code, name: "Too late" })).status).toBe(400);
  });

  it("stop working once expired", async () => {
    const team = mentor.teamId;
    const { code } = await newCode();
    await database
      .prepare("UPDATE log_downloader_codes SET expires_at = ? WHERE team_id = ?")
      .bind(Date.now() - 1, team)
      .run();
    expect((await pair(team, { code, name: "Late" })).status).toBe(400);
  });

  it("only work on their own team's address", async () => {
    const other = teamUsers(newTeamId());
    const { code } = await newCode();
    expect((await pair(other.teamId, { code, name: "Wrong team" })).status).toBe(400);
    expect((await pair(mentor.teamId, { code, name: "Right team" })).status).toBe(201);
  });
});

describe("a paired downloader", () => {
  it("is listed for the team without its key, and its key opens /downloader/me", async () => {
    const team = mentor.teamId;
    const { code } = await newCode();
    const { id, key } = (await (await pair(team, { code, name: "Listed" })).json()) as {
      id: number;
      key: string;
    };

    const me = await call("/downloader/me", asDownloader(team, key));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id, name: "Listed" });

    const list = await jsonAs<{ downloaders: Record<string, unknown>[]; canManage: boolean }>(
      student,
      "/downloaders",
    );
    expect(list.canManage).toBe(false);
    const row = list.downloaders.find((d) => d.id === id);
    expect(row).toMatchObject({
      name: "Listed",
      keyHint: key.slice(-4),
      pairedByName: mentor.displayName,
    });
    expect(row?.lastSeenAt).toEqual(expect.any(Number));
    expect(JSON.stringify(list)).not.toContain(key);
    expect(Object.keys(row ?? {})).not.toContain("keyHash");

    expect((await call("/downloader/me", asDownloader(team, "pld_wrong"))).status).toBe(401);
    expect((await callAs(student, "/downloader/me")).status).toBe(401);
  });

  it("only works on its own team's address", async () => {
    const { code } = await newCode();
    const { key } = (await (await pair(mentor.teamId, { code, name: "Home" })).json()) as {
      key: string;
    };
    expect((await call("/downloader/me", asDownloader(newTeamId(), key))).status).toBe(401);
  });

  it("stops working when a mentor removes it, and students can't", async () => {
    const team = mentor.teamId;
    const { code } = await newCode();
    const { id, key } = (await (await pair(team, { code, name: "Removed" })).json()) as {
      id: number;
      key: string;
    };
    expect((await callAs(student, `/downloaders/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await callAs(mentor, `/downloaders/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call("/downloader/me", asDownloader(team, key))).status).toBe(401);
  });

  it("gets its own team's appearance, and nobody else does", async () => {
    const other = teamUsers(newTeamId());
    const { code } = await jsonAs<{ code: string }>(
      other.mentor,
      "/downloaders/codes",
      { method: "POST" },
      201,
    );
    const { key } = (await (await pair(other.teamId, { code, name: "Styled" })).json()) as {
      key: string;
    };
    const res = await call("/downloader/team-ui", asDownloader(other.teamId, key));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ shortName: other.teamId.replace("frc", "") });
    expect((await callAs(student, "/downloader/team-ui")).status).toBe(401);
  });

  it("can unpair itself", async () => {
    const team = mentor.teamId;
    const { code } = await newCode();
    const { key } = (await (await pair(team, { code, name: "Leaving" })).json()) as {
      key: string;
    };
    const res = await call("/downloader/me", asDownloader(team, key, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect((await call("/downloader/me", asDownloader(team, key))).status).toBe(401);
  });
});
