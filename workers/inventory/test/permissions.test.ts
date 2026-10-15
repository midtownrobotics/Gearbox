import { student, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("student inventory permissions", () => {
  it("grants item operations separately from configuration", async () => {
    const delegated = testUser({ ...student, permissions: { inventory: ["items"] } });
    expect(await jsonAs(delegated, "/me")).toMatchObject({ isAdmin: false, isMentor: true });
    expect((await callAs(delegated, "/setup/export")).status).toBe(403);
    expect((await callAs(student, "/items/missing", { method: "DELETE" })).status).toBe(403);
    expect((await callAs(delegated, "/items/missing", { method: "DELETE" })).status).toBe(404);
  });
  it("includes item operations in Manage Inventory and refuses kiosk elevation", async () => {
    const delegated = testUser({ ...student, permissions: { inventory: ["manage"] } });
    expect(await jsonAs(delegated, "/me")).toMatchObject({ isAdmin: true, isMentor: true });
    expect((await callAs(delegated, "/setup/export")).status).toBe(200);
    expect((await callAs({ ...delegated, sessionType: "pin" }, "/setup/export")).status).toBe(403);
  });
});
