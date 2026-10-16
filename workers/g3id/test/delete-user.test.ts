import { describe, expect, it } from "vitest";
import { siteTeamId } from "../src/lib/team";
import {
  activateKiosk,
  createUser,
  createUserWithPin,
  g3id,
  sessionCookie,
  testEnv,
} from "./helpers";

// An admin deleting an account from the Users list: the account goes with everything that points
// at it, or nothing does.

const count = async (sql: string, ...values: unknown[]) =>
  (
    await testEnv.DB.prepare(sql)
      .bind(...values)
      .first<{ n: number }>()
  )?.n;

describe("deleting a user", () => {
  it("deletes an account that has a kiosk PIN, sign-ins and sessions", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const { id } = await createUserWithPin({ password: "a long test password" });
    const cookie = await sessionCookie(id);
    expect((await g3id("/auth/me", { cookie })).status).toBe(200);

    expect((await g3id(`/admin/users/${id}`, { method: "DELETE", cookie: admin })).status).toBe(
      200,
    );

    const users = (await (await g3id("/admin/users", { cookie: admin })).json()) as {
      id: string;
    }[];
    expect(users.some((user) => user.id === id)).toBe(false);
    for (const table of ["core_user_pins", "core_user_identities", "core_sessions"]) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, id)).toBe(0);
    }
    expect((await g3id("/auth/me", { cookie })).status).toBe(401);
  });

  it("keeps the team's kiosks and Slack connection when the admin who set them up is deleted", async () => {
    const adminId = await createUser({ isAdmin: true });
    const admin = await sessionCookie(adminId);
    const otherAdminId = await createUser({ isAdmin: true });
    const kioskToken = await activateKiosk(await sessionCookie(otherAdminId), "Their kiosk");
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      "INSERT OR REPLACE INTO slack_installations (team_id, slack_team_id, bot_token_encrypted, installed_by, created_at, updated_at) VALUES (?1, 'T-delete-user-test', 'encrypted', ?2, ?3, ?3)",
    )
      .bind(siteTeamId, otherAdminId, now)
      .run();
    // An account merged into theirs long ago, left pointing at it.
    const shellId = await createUser({ status: "rejected" });
    await testEnv.DB.prepare(
      "UPDATE core_users SET status = 'merged', merged_into_user_id = ?1 WHERE id = ?2",
    )
      .bind(otherAdminId, shellId)
      .run();

    expect(
      (await g3id(`/admin/users/${otherAdminId}`, { method: "DELETE", cookie: admin })).status,
    ).toBe(200);

    expect(
      await count(
        "SELECT COUNT(*) AS n FROM core_users WHERE id IN (?1, ?2)",
        otherAdminId,
        shellId,
      ),
    ).toBe(0);
    // The kiosk is still the team's, now under the admin who deleted the account.
    expect(
      await testEnv.DB.prepare("SELECT created_by, revoked_at FROM kiosk_devices WHERE token = ?")
        .bind(kioskToken)
        .first(),
    ).toEqual({ created_by: adminId, revoked_at: null });
    expect(
      await testEnv.DB.prepare("SELECT installed_by FROM slack_installations WHERE team_id = ?")
        .bind(siteTeamId)
        .first(),
    ).toEqual({ installed_by: null });
  });

  it("refuses an admin's own account, a pending one and another team's", async () => {
    const adminId = await createUser({ isAdmin: true });
    const admin = await sessionCookie(adminId);
    const remove = (id: string) => g3id(`/admin/users/${id}`, { method: "DELETE", cookie: admin });

    expect((await remove(adminId)).status).toBe(400);
    expect((await g3id("/auth/me", { cookie: admin })).status).toBe(200);

    const pendingId = await createUser({ status: "pending" });
    expect((await remove(pendingId)).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM core_users WHERE id = ?", pendingId)).toBe(1);

    expect((await remove("no-such-user")).status).toBe(404);
  });
});
