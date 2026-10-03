import { admin, kioskAdmin, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// G3 Shop: parts and processes for anyone signed in, kiosk presence for kiosk PIN sessions, and
// settings for admins (never from a kiosk).

describe("sign-in and roles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/subsystems")).status).toBe(401);
  });

  it("reports a kiosk PIN session and its device", async () => {
    expect(await jsonAs(student, "/me")).toMatchObject({
      sessionType: "oauth",
      kioskDeviceId: null,
    });
    expect(await jsonAs(kioskAdmin, "/me")).toMatchObject({
      sessionType: "pin",
      isAdmin: false,
      kioskDeviceId: 1,
      kioskDeviceName: "Test Kiosk",
    });
  });

  it("keeps settings to admins, never kiosk PIN sessions", async () => {
    for (const path of ["/admin/slack/config", "/admin/onshape/config"]) {
      expect((await callAs(student, path)).status).toBe(403);
      expect((await callAs(kioskAdmin, path)).status).toBe(403);
      expect((await callAs(admin, path)).status).toBe(200);
    }
    const set = await callAs(admin, "/admin/slack/config", {
      method: "POST",
      body: { slackReleaseChannelId: "C123" },
    });
    expect(set.status).toBe(200);
    expect(await jsonAs(admin, "/admin/slack/config")).toMatchObject({
      slackReleaseChannelId: "C123",
    });
  });
});

describe("subsystems and processes", () => {
  it("creates and lists them", async () => {
    const subsystem = await jsonAs<{ id: number; name: string }>(
      student,
      "/subsystems",
      { method: "POST", body: { name: "Intake" } },
      201,
    );
    expect((await jsonAs<{ name: string }[]>(student, "/subsystems")).map((s) => s.name)).toContain(
      subsystem.name,
    );
    const process = await jsonAs<{ name: string; type: string }>(
      student,
      "/processes",
      { method: "POST", body: { name: "Laser cut" } },
      201,
    );
    expect(process).toMatchObject({ name: "Laser cut", type: "regular" });
  });

  it("validates them", async () => {
    expect(
      (await callAs(student, "/processes", { method: "POST", body: { name: "" } })).status,
    ).toBe(400);
    expect(
      (
        await callAs(student, "/processes", {
          method: "POST",
          body: { name: "X", type: "teleport" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("kiosk presence", () => {
  it("records who's at a kiosk from its PIN session only", async () => {
    expect((await callAs(student, "/kiosk-presence/heartbeat", { method: "POST" })).status).toBe(
      400,
    );
    expect((await callAs(kioskAdmin, "/kiosk-presence/heartbeat", { method: "POST" })).status).toBe(
      200,
    );
    expect(await jsonAs(student, "/kiosk-presence")).toEqual([
      expect.objectContaining({
        kioskDeviceId: 1,
        userId: kioskAdmin.id,
        deviceName: "Test Kiosk",
      }),
    ]);
  });

  it("clears a kiosk's presence when its user logs out", async () => {
    await callAs(kioskAdmin, "/kiosk-presence/heartbeat", { method: "POST" });
    expect((await callAs(kioskAdmin, "/logout", { method: "POST" })).status).toBe(200);
    expect(await jsonAs(student, "/kiosk-presence")).toEqual([]);
  });
});

describe("printing", () => {
  it("fails fast when the shop's edge box is offline", async () => {
    const res = await callAs(student, "/print?title=test", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: "%PDF-1.4",
    });
    expect(res.status).toBe(503);
  });
});

describe("removed test routes", () => {
  it("no longer has the seed, test-drawing and Slack test routes", async () => {
    expect((await callAs(admin, "/admin/seed-test-parts")).status).toBe(404);
    expect((await call("/admin/dev/test-drawing/P-1/A", { method: "POST" })).status).toBe(404);
    expect((await call("/slack-test")).status).toBe(404);
  });
});
