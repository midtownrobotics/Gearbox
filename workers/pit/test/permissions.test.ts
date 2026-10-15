import { admin, student, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("app-scoped trusted students", () => {
  it("allows a Pit trusted student to edit settings without making them an ID trusted student", async () => {
    const trusted = testUser({
      id: student.id,
      permissions: { pit: ["manage"] },
    });
    expect(await jsonAs(trusted, "/me")).toMatchObject({ isAdmin: true });
    expect((await callAs(trusted, "/admin/settings")).status).toBe(200);
    const wrongApp = testUser({
      id: student.id,
      permissions: { shop: ["manage"] },
    });
    expect((await callAs(wrongApp, "/admin/settings")).status).toBe(403);
  });
  it("keeps site-wide Admin access and refuses kiosk and forged-header elevation", async () => {
    const revoked = {
      ...admin,
      permissions: { pit: [] },
    };
    expect((await callAs(revoked, "/admin/settings")).status).toBe(200);
    const kiosk = testUser({
      id: student.id,
      sessionType: "pin",
      permissions: { pit: ["manage"] },
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
