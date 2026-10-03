import { admin, kioskAdmin, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// G3 Attendance. Records live in Google Firestore, which these tests don't reach: they cover
// sign-in, roles and the kiosk code checks that happen before any Firestore call.

describe("sign-in and roles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/leaderboard")).status).toBe(401);
    expect(await jsonAs(student, "/me")).toMatchObject({ id: student.id, isAdmin: false });
  });

  it("gives the kiosk QR code to admins only, never a kiosk PIN session", async () => {
    expect((await callAs(student, "/code")).status).toBe(403);
    expect((await callAs(kioskAdmin, "/code")).status).toBe(403);
    const { w } = await jsonAs<{ w: number }>(admin, "/code");
    expect(Number.isSafeInteger(w)).toBe(true);
  });

  it("keeps attendance admin to admins", async () => {
    for (const [method, path] of [
      ["GET", "/admin/summary"],
      ["POST", "/admin/members/someone/signout"],
      ["POST", "/admin/members/someone/add-hours"],
      ["DELETE", "/admin/members/someone"],
    ] as const) {
      expect(
        (await callAs(student, path, { method, body: method === "GET" ? undefined : {} })).status,
      ).toBe(403);
      expect(
        (await callAs(kioskAdmin, path, { method, body: method === "GET" ? undefined : {} }))
          .status,
      ).toBe(403);
    }
  });
});

describe("kiosk code", () => {
  it("rejects a stale or future code before touching any records", async () => {
    const now = Math.floor(Date.now() / 30_000);
    for (const w of [now - 10, now + 1, -1]) {
      const res = await callAs(student, "/signin", { method: "POST", body: { w } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "TOKEN_EXPIRED" });
    }
    const out = await callAs(student, "/signout", { method: "POST", body: { w: now - 10 } });
    expect(out.status).toBe(400);
  });
});
