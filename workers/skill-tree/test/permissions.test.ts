import { admin, mentor, student, testUser } from "@g3/testing/users";
import { callAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("student skill permissions", () => {
  it("lets a student manage skills without granting a site-wide role", async () => {
    const delegated = testUser({ ...student, permissions: { skillTree: ["skills"] } });
    expect((await callAs(student, "/trees/default")).status).toBe(403);
    expect((await callAs(delegated, "/trees/default")).status).toBe(200);
    expect((await callAs({ ...delegated, sessionType: "pin" }, "/trees/default")).status).toBe(403);
    expect(
      (await callAs(testUser({ ...student, permissions: { shop: ["manage"] } }), "/trees/default"))
        .status,
    ).toBe(403);
  });
  it("preserves site-wide Admin and Mentor access", async () => {
    for (const user of [admin, mentor])
      expect((await callAs(user, "/trees/default")).status).toBe(200);
  });
});
