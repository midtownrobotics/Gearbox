import { admin, student, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("app-scoped trusted students", () => {
  it("allows a Pit trusted student to edit settings without making them an ID trusted student", async () => {
    const trusted = testUser({
      id: student.id,
      appPermissions: { pit: { trustedStudent: true, mentorAccess: false } },
    });
    expect(await jsonAs(trusted, "/me")).toMatchObject({ isAdmin: true });
    expect((await callAs(trusted, "/admin/settings")).status).toBe(200);
    const wrongApp = testUser({
      id: student.id,
      appPermissions: { shop: { trustedStudent: true, mentorAccess: true } },
    });
    expect((await callAs(wrongApp, "/admin/settings")).status).toBe(403);
  });
  it("honors explicit revocation and refuses kiosk and forged-header elevation", async () => {
    const revoked = {
      ...admin,
      appPermissions: { pit: { trustedStudent: false, mentorAccess: false } },
    };
    expect((await callAs(revoked, "/admin/settings")).status).toBe(403);
    const kiosk = testUser({
      id: student.id,
      sessionType: "pin",
      appPermissions: { pit: { trustedStudent: true, mentorAccess: true } },
    });
    expect((await callAs(kiosk, "/admin/settings")).status).toBe(403);
    expect(
      (
        await callAs(student, "/admin/settings", {
          headers: { "X-User-Roles": "admin", "X-Permission-App": "id" },
        })
      ).status,
    ).toBe(403);
  });
});
