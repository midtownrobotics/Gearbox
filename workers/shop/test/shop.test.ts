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
    for (const path of ["/admin/chat/config", "/admin/onshape/config"]) {
      expect((await callAs(student, path)).status).toBe(403);
      expect((await callAs(kioskAdmin, path)).status).toBe(403);
      expect((await callAs(admin, path)).status).toBe(200);
    }
    const set = await callAs(admin, "/admin/chat/config", {
      method: "POST",
      body: { releaseChannelId: "C123" },
    });
    expect(set.status).toBe(200);
    expect(await jsonAs(admin, "/admin/chat/config")).toMatchObject({
      releaseChannelId: "C123",
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

describe("obsolete parts", () => {
  type Id = { id: number };
  type Instance = Id & { isStale: number; obsoletedAt: number | null; obsoletedBy: string | null };
  const post = (body: unknown) => ({ method: "POST", body });
  const patch = (body: unknown) => ({ method: "PATCH", body });
  /** A part of its own with `quantity` instances. */
  async function seed(quantity: number) {
    const tag = crypto.randomUUID().slice(0, 8);
    const subsystem = await jsonAs<Id>(student, "/subsystems", post({ name: `Arm ${tag}` }), 201);
    const process = await jsonAs<Id>(student, "/processes", post({ name: `Mill ${tag}` }), 201);
    const part = await jsonAs<Id>(
      student,
      "/part-definitions",
      post({
        onshapePartNumber: `OBS-${tag}`,
        revision: "A",
        subsystemId: subsystem.id,
        name: "Plate",
        processIds: [process.id],
      }),
      201,
    );
    const instances = await jsonAs<Instance[]>(
      student,
      "/part-instances",
      post({ partDefinitionId: part.id, quantity }),
      201,
    );
    return { part, instances };
  }

  it("keeps when a part was made obsolete and by whom", async () => {
    const { instances } = await seed(1);
    expect(instances[0]).toMatchObject({ isStale: 0, obsoletedAt: null, obsoletedBy: null });

    const before = Date.now();
    const made = await jsonAs<Instance>(
      admin,
      `/part-instances/${instances[0].id}`,
      patch({ isStale: true }),
    );
    expect(made).toMatchObject({ isStale: 1, obsoletedBy: admin.id });
    expect(made.obsoletedAt).toBeGreaterThanOrEqual(before);

    // Saying so again, or changing something else, leaves the first record as it is.
    const again = await jsonAs<Instance>(
      student,
      `/part-instances/${instances[0].id}`,
      patch({ isStale: true, isPriority: true }),
    );
    expect(again).toMatchObject({ obsoletedAt: made.obsoletedAt, obsoletedBy: admin.id });

    // Bringing it back forgets them.
    const back = await jsonAs<Instance>(
      student,
      `/part-instances/${instances[0].id}`,
      patch({ isStale: false }),
    );
    expect(back).toMatchObject({ isStale: 0, obsoletedAt: null, obsoletedBy: null });
  });
});
