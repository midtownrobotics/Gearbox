// SPDX-License-Identifier: AGPL-3.0-only
import { teamKey } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { createTeam, createUserWithPin, g3id, sessionCookie, testEnv } from "./helpers";

// A team that changed program moves to its id in the other program ("frc12345" → "ftc12345", the
// platform's src/moves.ts): its accounts, PINs, settings and chat go with it, sessions keep
// working, and the old id is gone.

const count = async (sql: string, ...binds: unknown[]) =>
  (
    await testEnv.DB.prepare(sql)
      .bind(...binds)
      .first<{ n: number }>()
  )?.n ?? 0;

describe("moving a team", () => {
  it("moves its accounts, PINs and settings to the new id, and its sessions keep working", async () => {
    const from = await createTeam();
    const to = from.replace(/^frc/, "ftc");
    const { id: userId } = await createUserWithPin({ teamId: from, isAdmin: true });
    await testEnv.DB.prepare(
      "INSERT INTO team_ui_settings (team_id, settings_json, updated_at) VALUES (?, '{}', 1)",
    )
      .bind(from)
      .run();
    await testEnv.DB.prepare(
      "INSERT INTO team_storage_policy (team_id, automatic_deletion, updated_at) VALUES (?, 0, 1)",
    )
      .bind(from)
      .run();
    const cookie = await sessionCookie(userId);

    const res = await g3id(`/api/internal/teams/${from}/move`, { method: "POST", body: { to } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: true });

    expect(await count("SELECT count(*) AS n FROM teams WHERE id = ?", from)).toBe(0);
    const team = await testEnv.DB.prepare("SELECT program, team_number FROM teams WHERE id = ?")
      .bind(to)
      .first<{ program: string; team_number: number }>();
    expect(team).toEqual({ program: "ftc", team_number: Number(from.slice(3)) });
    for (const table of [
      "core_users",
      "core_user_pins",
      "team_ui_settings",
      "team_storage_policy",
    ]) {
      expect(await count(`SELECT count(*) AS n FROM ${table} WHERE team_id = ?`, from)).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM ${table} WHERE team_id = ?`, to)).toBe(1);
    }
    const me = await g3id("/api/auth/me", { cookie });
    expect(await me.json()).toMatchObject({ id: userId, teamId: to });

    // Again, after it's done: nothing left to move.
    const again = await g3id(`/api/internal/teams/${from}/move`, { method: "POST", body: { to } });
    expect(again.status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM core_users WHERE team_id = ?", to)).toBe(1);
  });

  it("moves only to the same number in the other program, and never the site's team", async () => {
    const from = await createTeam();
    const other = await createTeam();
    for (const to of [other, "ftc1", from, "nope"]) {
      const res = await g3id(`/api/internal/teams/${from}/move`, { method: "POST", body: { to } });
      expect(res.status).toBe(400);
    }
    const site = await g3id(`/api/internal/teams/${teamKey}/move`, {
      method: "POST",
      body: { to: teamKey.replace(/^frc/, "ftc") },
    });
    expect(site.status).toBe(400);
  });

  it("takes a new team's program from its id", async () => {
    const number = 2_000_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);
    const res = await g3id("/api/internal/teams", {
      method: "PUT",
      body: { id: `ftc${number}`, teamNumber: number, name: "An FTC Team" },
    });
    expect(res.status).toBe(200);
    expect(
      await count(
        "SELECT count(*) AS n FROM teams WHERE id = ? AND program = 'ftc'",
        `ftc${number}`,
      ),
    ).toBe(1);
    const wrong = await g3id("/api/internal/teams", {
      method: "PUT",
      body: { id: `ftc${number}`, teamNumber: number + 1, name: "Mismatched" },
    });
    expect(wrong.status).toBe(400);
  });
});
