import { admin, kioskAdmin, mentor, student } from "@g3/testing/users";
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

describe("obsolete parts", () => {
  type Id = { id: number };
  type Instance = Id & { isStale: number; obsoletedAt: number | null; obsoletedBy: string | null };
  const post = (body: unknown) => ({ method: "POST", body });
  const patch = (body: unknown) => ({ method: "PATCH", body });
  const assign = (file: Id, part: Id, count: number) =>
    callAs(student, `/part-files/${file.id}/assignments`, {
      method: "PUT",
      body: { partDefinitionId: part.id, count },
    });

  /** A part of its own with `quantity` instances, and a file. */
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
    const form = new FormData();
    form.set("file", new File(["G-code"], `plate-${tag}.nc`, { type: "text/plain" }));
    const file = await jsonAs<Id>(student, "/part-files", { method: "POST", body: form }, 201);
    return { part, instances, file };
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

  it("won't assign a file to a part whose every instance is obsolete", async () => {
    const { part, instances, file } = await seed(2);
    expect(await (await assign(file, part, 1)).json()).toMatchObject({ assigned: 1 });

    // One obsolete instance of two: the part is still live.
    await jsonAs(student, `/part-instances/${instances[1].id}`, patch({ isStale: true }));
    expect((await assign(file, part, 1)).status).toBe(200);

    await jsonAs(student, `/part-instances/${instances[0].id}`, patch({ isStale: true }));
    const refused = await assign(file, part, 2);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Rev A is obsolete/);

    // Taking the file off it is still allowed.
    expect(await (await assign(file, part, 0)).json()).toMatchObject({ assigned: 0 });
  });
});

describe("quality control", () => {
  type Id = { id: number };
  const post = (body?: unknown) => ({ method: "POST" as const, body });
  const put = (body: unknown) => ({ method: "PUT" as const, body });

  /** A Quality Control step, a plain step, and a part with both (the check last). */
  async function seed({ required = false }: { required?: boolean } = {}) {
    const tag = crypto.randomUUID().slice(0, 8);
    const subsystem = await jsonAs<Id>(student, "/subsystems", post({ name: `Drive ${tag}` }), 201);
    const mill = await jsonAs<Id>(student, "/processes", post({ name: `Mill ${tag}` }), 201);
    const check = await jsonAs<Id>(
      admin,
      "/processes",
      post({ name: `QC ${tag}`, type: "quality_control" }),
      201,
    );
    if (required) {
      await jsonAs(
        admin,
        "/admin/quality/settings",
        put({ requireQualityCheck: true, qualityProcessId: check.id }),
      );
    }
    const part = await jsonAs<Id>(
      student,
      "/part-definitions",
      post({
        onshapePartNumber: `QC-${tag}`,
        revision: "A",
        subsystemId: subsystem.id,
        name: "Plate",
        processIds: required ? [mill.id] : [mill.id, check.id],
      }),
      201,
    );
    const instances = await jsonAs<Id[]>(
      student,
      "/part-instances",
      post({ partDefinitionId: part.id, quantity: 2 }),
      201,
    );
    return { tag, mill, check, part, instances };
  }

  it("only lets an admin make a process a quality check", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    expect(
      (await callAs(student, "/processes", post({ name: `QC ${tag}`, type: "quality_control" })))
        .status,
    ).toBe(403);
    const check = await jsonAs<{ id: number; type: string }>(
      admin,
      "/processes",
      post({ name: `QC ${tag}`, type: "quality_control" }),
      201,
    );
    expect(check.type).toBe("quality_control");
    // Nor can a student take the type away again.
    expect(
      (
        await callAs(student, `/processes/${check.id}`, {
          method: "PATCH",
          body: { type: "regular" },
        })
      ).status,
    ).toBe(403);
  });

  it("keeps checking a quality step off to shop managers and admins", async () => {
    const { mill, check, instances } = await seed();
    const [first, second] = instances;

    // The step before it is anyone's to finish.
    expect(
      (
        await callAs(
          student,
          `/part-instance-processes/${first.id}/processes/${mill.id}/done`,
          post(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await callAs(
          student,
          `/part-instance-processes/${first.id}/processes/${check.id}/done`,
          post(),
        )
      ).status,
    ).toBe(403);
    // Not through the bulk route or a plain status change either.
    expect(
      (
        await callAs(
          student,
          "/part-instance-processes/bulk",
          post({ processId: check.id, partInstanceIds: [first.id], to: "done" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await callAs(student, `/part-instance-processes/${first.id}/processes/${check.id}`, {
          method: "PATCH",
          body: { status: "done" },
        })
      ).status,
    ).toBe(403);
    // Starting it is fine: it's the sign-off that's kept back.
    expect(
      (
        await callAs(
          student,
          `/part-instance-processes/${first.id}/processes/${check.id}/doing`,
          post(),
        )
      ).status,
    ).toBe(200);

    // An admin may, and so may a shop manager they add.
    expect(
      (
        await callAs(
          admin,
          `/part-instance-processes/${first.id}/processes/${check.id}/done`,
          post(),
        )
      ).status,
    ).toBe(200);
    await jsonAs(admin, `/admin/quality/managers/${student.id}`, put({ manager: true }));
    expect(await jsonAs<{ isShopManager: boolean }>(student, "/me")).toMatchObject({
      isShopManager: true,
    });
    await jsonAs(
      student,
      `/part-instance-processes/${second.id}/processes/${mill.id}/done`,
      post(),
    );
    expect(
      (
        await callAs(
          student,
          `/part-instance-processes/${second.id}/processes/${check.id}/done`,
          post(),
        )
      ).status,
    ).toBe(200);

    // Taking it away again puts the step back out of reach.
    await jsonAs(admin, `/admin/quality/managers/${student.id}`, put({ manager: false }));
    expect(await jsonAs<{ isShopManager: boolean }>(student, "/me")).toMatchObject({
      isShopManager: false,
    });
  });

  it("only makes the team's own members shop managers, and only for admins", async () => {
    expect((await callAs(student, "/admin/quality")).status).toBe(403);
    expect((await callAs(kioskAdmin, "/admin/quality")).status).toBe(403);
    expect(
      (await callAs(student, `/admin/quality/managers/${student.id}`, put({ manager: true })))
        .status,
    ).toBe(403);
    expect(
      (await callAs(admin, "/admin/quality/managers/nobody-at-all", put({ manager: true }))).status,
    ).toBe(404);

    await jsonAs(admin, `/admin/quality/managers/${mentor.id}`, put({ manager: true }));
    const page = await jsonAs<{
      people: { id: string; isManager: boolean }[];
      peopleLoaded: boolean;
    }>(admin, "/admin/quality");
    expect(page.peopleLoaded).toBe(true);
    expect(page.people.find((p) => p.id === mentor.id)?.isManager).toBe(true);
    expect(page.people.find((p) => p.id === student.id)?.isManager).toBe(false);
    await jsonAs(admin, `/admin/quality/managers/${mentor.id}`, put({ manager: false }));
  });

  it("forgets the required check when its process stops being one", async () => {
    const { check } = await seed({ required: true });
    expect(await jsonAs<{ qualityCheck: unknown }>(admin, "/me")).toMatchObject({
      qualityCheck: { required: true, processId: check.id },
    });
    await jsonAs(admin, `/processes/${check.id}`, { method: "PATCH", body: { type: "regular" } });
    expect(await jsonAs<{ qualityCheck: unknown }>(admin, "/me")).toMatchObject({
      qualityCheck: { required: false, processId: null },
    });
  });

  it("puts a required quality check at the end of every part", async () => {
    const { mill, check, part } = await seed({ required: true });
    const blueprint = await jsonAs<{ processId: number; index: number }[]>(
      student,
      `/part-definitions/${part.id}/processes`,
    );
    expect(blueprint.map((b) => b.processId)).toEqual([mill.id, check.id]);

    // Asked for in the middle, it still ends up last.
    await jsonAs(
      student,
      `/part-definitions/${part.id}/processes`,
      put({ processIds: [check.id, mill.id] }),
    );
    expect(
      (
        await jsonAs<{ processId: number }[]>(student, `/part-definitions/${part.id}/processes`)
      ).map((b) => b.processId),
    ).toEqual([mill.id, check.id]);

    // And a new instance's pipeline ends with it.
    const [instance] = await jsonAs<Id[]>(
      student,
      "/part-instances",
      post({ partDefinitionId: part.id, quantity: 1 }),
      201,
    );
    const steps = await jsonAs<{ processId: number; index: number; status: string }[]>(
      student,
      `/part-instance-processes?partInstanceId=${instance.id}`,
    );
    expect(steps.sort((a, b) => a.index - b.index).map((s) => s.processId)).toEqual([
      mill.id,
      check.id,
    ]);

    // Turning it off again leaves new parts alone.
    await jsonAs(admin, "/admin/quality/settings", put({ requireQualityCheck: false }));
    await jsonAs(student, `/part-definitions/${part.id}/processes`, put({ processIds: [mill.id] }));
    expect(
      await jsonAs<{ processId: number }[]>(student, `/part-definitions/${part.id}/processes`),
    ).toHaveLength(1);
  });
});
