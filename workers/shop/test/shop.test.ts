import { admin, kioskAdmin, mentor, newTeamId, student, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { STARTER_CHECKLIST } from "../src/lib/quality-checklist";

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

describe("quality reports", () => {
  type Id = { id: number };
  type Step = { processId: number; index: number; status: string };
  type Report = {
    id: number;
    passed: number;
    unsure: number;
    outcome: string;
    suspects: { processId: number; completedBy: string | null; completedAt: number | null }[];
    notes: string | null;
    sentBackProcessName: string | null;
    fixNote: string | null;
    replacementInstanceNumber: number | null;
    checks: { label: string; ok: boolean }[];
  };
  const post = (body?: unknown) => ({ method: "POST" as const, body });
  const put = (body: unknown) => ({ method: "PUT" as const, body });
  const allGood = STARTER_CHECKLIST.map((label) => ({ label, ok: true }));
  /** The starter checklist with one line failed. */
  const oneBad = allGood.map((a, i) => (i === 1 ? { ...a, ok: false } : a));

  /**
   * A team of its own with reports on, and a part made through Mill and Deburr (by its student)
   * that's now waiting at its Quality Control step.
   */
  async function seed() {
    const team = teamUsers(newTeamId());
    const { admin, student } = team;
    const subsystem = await jsonAs<Id>(student, "/subsystems", post({ name: "Arm" }), 201);
    const mill = await jsonAs<Id>(student, "/processes", post({ name: "Mill" }), 201);
    const deburr = await jsonAs<Id>(student, "/processes", post({ name: "Deburr" }), 201);
    const check = await jsonAs<Id>(
      admin,
      "/processes",
      post({ name: "QC", type: "quality_control" }),
      201,
    );
    await jsonAs(admin, "/admin/quality/settings", put({ qualityReports: true }));
    const part = await jsonAs<Id>(
      student,
      "/part-definitions",
      post({
        onshapePartNumber: "QR-1",
        revision: "A",
        subsystemId: subsystem.id,
        name: "Bracket",
        processIds: [mill.id, deburr.id, check.id],
      }),
      201,
    );
    const [instance] = await jsonAs<Id[]>(
      student,
      "/part-instances",
      post({ partDefinitionId: part.id, quantity: 1 }),
      201,
    );
    for (const step of [mill, deburr]) {
      await jsonAs(
        student,
        `/part-instance-processes/${instance.id}/processes/${step.id}/done`,
        post(),
      );
    }
    const steps = async () =>
      (
        await jsonAs<Step[]>(student, `/part-instance-processes?partInstanceId=${instance.id}`)
      ).sort((a, b) => a.index - b.index);
    return { team, mill, deburr, check, instance, part, steps };
  }

  it("finish a Quality Control step only with a report while they're on", async () => {
    const { team, check, instance, steps } = await seed();
    expect(await jsonAs<{ qualityReports: boolean }>(team.admin, "/me")).toMatchObject({
      qualityReports: true,
    });
    const done = await callAs(
      team.admin,
      `/part-instance-processes/${instance.id}/processes/${check.id}/done`,
      post(),
    );
    expect(done.status).toBe(403);
    // Only shop managers and admins write one.
    const body = { partInstanceId: instance.id, processId: check.id, checks: allGood };
    expect((await callAs(team.student, "/quality-reports", post(body))).status).toBe(403);

    const { report } = await jsonAs<{ report: Report }>(
      team.admin,
      "/quality-reports",
      post({ ...body, notes: "Looks right" }),
      201,
    );
    expect(report).toMatchObject({ passed: 1, outcome: "passed", notes: "Looks right" });
    expect((await steps()).map((s) => s.status)).toEqual(["done", "done", "done"]);
    // Not twice.
    expect((await callAs(team.admin, "/quality-reports", post(body))).status).toBe(409);
  });

  it("record a problem with who did the likely step, then send the part back", async () => {
    const { team, mill, deburr, check, instance, steps } = await seed();
    const base = { partInstanceId: instance.id, processId: check.id, checks: oneBad };
    // A failed check needs a likely step, or Unsure, and only one the part went through.
    expect((await callAs(team.admin, "/quality-reports", post(base))).status).toBe(400);
    expect(
      (
        await callAs(
          team.admin,
          "/quality-reports",
          post({ ...base, suspectProcessIds: [check.id] }),
        )
      ).status,
    ).toBe(400);

    const { report, history } = await jsonAs<{
      report: Report;
      history: { processId: number }[];
    }>(
      team.admin,
      "/quality-reports",
      post({ ...base, suspectProcessIds: [mill.id], unsure: true, notes: "Too thin" }),
      201,
    );
    expect(report).toMatchObject({ passed: 0, unsure: 1, outcome: "not_sent_back" });
    expect(report.suspects).toEqual([
      expect.objectContaining({ processId: mill.id, completedBy: team.student.id }),
    ]);
    expect(report.suspects[0].completedAt).toBeGreaterThan(0);
    expect(history.map((h) => h.processId)).toEqual([mill.id, deburr.id]);
    // The part stays at the check until it's sent back.
    expect((await steps()).map((s) => s.status)).toEqual(["done", "done", "todo"]);

    // Back to Mill: Mill is to do again, and everything after it waits, the check included.
    expect(
      (
        await callAs(
          team.student,
          `/quality-reports/${report.id}/send-back`,
          post({ processId: mill.id, status: "todo" }),
        )
      ).status,
    ).toBe(403);
    // Only a step this part actually has.
    const spare = await jsonAs<Id>(team.student, "/processes", post({ name: "Lathe" }), 201);
    expect(
      (
        await callAs(
          team.admin,
          `/quality-reports/${report.id}/send-back`,
          post({ processId: spare.id, status: "todo" }),
        )
      ).status,
    ).toBe(400);
    await jsonAs(
      team.admin,
      `/quality-reports/${report.id}/send-back`,
      post({ processId: mill.id, status: "todo" }),
    );
    expect((await steps()).map((s) => s.status)).toEqual(["todo", "waiting", "waiting"]);
    expect(
      (
        await callAs(
          team.admin,
          `/quality-reports/${report.id}/send-back`,
          post({ processId: mill.id, status: "todo" }),
        )
      ).status,
    ).toBe(409);

    // The Admin page's table has it, for admins only.
    expect((await callAs(team.student, "/quality-reports")).status).toBe(403);
    const reports = await jsonAs<Report[]>(team.admin, "/quality-reports");
    expect(reports.find((r) => r.id === report.id)).toMatchObject({
      outcome: "sent_back",
      sentBackProcessName: "Mill",
    });
  });

  it("are refused while they're off", async () => {
    const team = teamUsers(newTeamId());
    const res = await callAs(
      team.admin,
      "/quality-reports",
      post({ partInstanceId: 1, processId: 1, checks: allGood }),
    );
    expect(res.status).toBe(409);
  });

  it("sends a part to any of its steps, the check itself included", async () => {
    const { team, check, instance, steps } = await seed();
    const { report } = await jsonAs<{ report: Report }>(
      team.admin,
      "/quality-reports",
      post({ partInstanceId: instance.id, processId: check.id, checks: oneBad, unsure: true }),
      201,
    );
    // Back to the check itself: it's to do again and nothing before it is touched.
    await jsonAs(
      team.admin,
      `/quality-reports/${report.id}/send-back`,
      post({ processId: check.id, status: "doing" }),
    );
    expect((await steps()).map((s) => s.status)).toEqual(["done", "done", "doing"]);
  });

  it("writes a fix onto the part's notes and needs the note", async () => {
    const { team, mill, check, instance, part, steps } = await seed();
    const { report } = await jsonAs<{ report: Report }>(
      team.admin,
      "/quality-reports",
      post({ partInstanceId: instance.id, processId: check.id, checks: oneBad, unsure: true }),
      201,
    );
    // A fix without a note is refused: the note is what the shop reads.
    expect(
      (
        await callAs(
          team.admin,
          `/quality-reports/${report.id}/send-back`,
          post({ processId: mill.id, status: "todo", fix: true, fixNote: "  " }),
        )
      ).status,
    ).toBe(400);

    await jsonAs(
      team.admin,
      `/quality-reports/${report.id}/send-back`,
      post({ processId: mill.id, status: "todo", fix: true, fixNote: "Deburr the top edge" }),
    );
    expect((await steps()).map((s) => s.status)).toEqual(["todo", "waiting", "waiting"]);

    const definitions = await jsonAs<{ id: number; notes: string | null }[]>(
      team.student,
      "/part-definitions",
    );
    expect(definitions.find((d) => d.id === part.id)?.notes).toContain("Deburr the top edge");
    const reports = await jsonAs<Report[]>(team.admin, "/quality-reports");
    expect(reports.find((r) => r.id === report.id)).toMatchObject({
      outcome: "fixed",
      fixNote: "Deburr the top edge",
      sentBackProcessName: "Mill",
    });
  });

  it("adds a step this part never had when a fix sends it there", async () => {
    const { team, check, instance, steps } = await seed();
    const sanding = await jsonAs<Id>(team.student, "/processes", post({ name: "Sanding" }), 201);
    const { report } = await jsonAs<{ report: Report }>(
      team.admin,
      "/quality-reports",
      post({ partInstanceId: instance.id, processId: check.id, checks: oneBad, unsure: true }),
      201,
    );

    // A plain send back can only reach a step the part has.
    expect(
      (
        await callAs(
          team.admin,
          `/quality-reports/${report.id}/send-back`,
          post({ processId: sanding.id, status: "todo" }),
        )
      ).status,
    ).toBe(400);
    // Nor can a file step join one part: those have to be paired across the whole list.
    const nest = await jsonAs<Id>(
      team.student,
      "/processes",
      post({ name: "Nest", type: "file_producer" }),
      201,
    );
    expect(
      (
        await callAs(
          team.admin,
          `/quality-reports/${report.id}/send-back`,
          post({ processId: nest.id, status: "todo", fix: true, fixNote: "Re-nest it" }),
        )
      ).status,
    ).toBe(400);

    await jsonAs(
      team.admin,
      `/quality-reports/${report.id}/send-back`,
      post({ processId: sanding.id, status: "todo", fix: true, fixNote: "Sand the face" }),
    );
    // Sanding slots in before the check, which waits its turn again at the end.
    const after = await steps();
    expect(after.map((s) => [s.processId, s.status])).toEqual([
      [expect.any(Number), "done"],
      [expect.any(Number), "done"],
      [sanding.id, "todo"],
      [check.id, "waiting"],
    ]);
    expect(after.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("obsoletes the part and starts a new one over", async () => {
    const { team, check, instance, part } = await seed();
    const { report } = await jsonAs<{ report: Report }>(
      team.admin,
      "/quality-reports",
      post({ partInstanceId: instance.id, processId: check.id, checks: oneBad, unsure: true }),
      201,
    );
    expect(
      (await callAs(team.student, `/quality-reports/${report.id}/replace`, post())).status,
    ).toBe(403);

    const { replacement } = await jsonAs<{ replacement: { id: number; instanceNumber: number } }>(
      team.admin,
      `/quality-reports/${report.id}/replace`,
      post(),
    );
    const instances = await jsonAs<{ id: number; isStale: number; obsoletedBy: string | null }[]>(
      team.student,
      `/part-instances?partDefinitionId=${part.id}`,
    );
    expect(instances.find((i) => i.id === instance.id)).toMatchObject({
      isStale: 1,
      obsoletedBy: team.admin.id,
    });
    // The new one starts at the first step with the whole pipeline ahead of it.
    const fresh = await jsonAs<Step[]>(
      team.student,
      `/part-instance-processes?partInstanceId=${replacement.id}`,
    );
    expect(fresh.sort((a, b) => a.index - b.index).map((s) => s.status)).toEqual([
      "todo",
      "waiting",
      "waiting",
    ]);
    // And only once.
    expect((await callAs(team.admin, `/quality-reports/${report.id}/replace`, post())).status).toBe(
      409,
    );
    const reports = await jsonAs<Report[]>(team.admin, "/quality-reports");
    expect(reports.find((r) => r.id === report.id)).toMatchObject({
      outcome: "replaced",
      replacementInstanceNumber: replacement.instanceNumber,
    });
  });

  it("asks the team's own checklist, and keeps what old reports were answered against", async () => {
    const { team, check, instance } = await seed();
    expect(await jsonAs<{ qualityChecklist: string[] }>(team.admin, "/me")).toMatchObject({
      qualityChecklist: [...STARTER_CHECKLIST],
    });

    // A blank line, a repeat, and an empty list are all refused.
    for (const checklist of [["Flat?", " "], ["Flat?", "flat?"], []]) {
      expect(
        (await callAs(team.admin, "/admin/quality/checklist", put({ checklist }))).status,
      ).toBe(400);
    }
    expect(
      (await callAs(team.student, "/admin/quality/checklist", put({ checklist: ["Flat?"] })))
        .status,
    ).toBe(403);

    const saved = await jsonAs<{ checklist: string[] }>(
      team.admin,
      "/admin/quality/checklist",
      put({ checklist: ["Is it flat?", "Are the holes round?"] }),
    );
    expect(saved.checklist).toEqual(["Is it flat?", "Are the holes round?"]);
    expect(await jsonAs<{ qualityChecklist: string[] }>(team.admin, "/me")).toMatchObject({
      qualityChecklist: ["Is it flat?", "Are the holes round?"],
    });

    // The old four no longer answer the new list.
    expect(
      (
        await callAs(
          team.admin,
          "/quality-reports",
          post({ partInstanceId: instance.id, processId: check.id, checks: allGood }),
        )
      ).status,
    ).toBe(409);

    const { report } = await jsonAs<{ report: Report }>(
      team.admin,
      "/quality-reports",
      post({
        partInstanceId: instance.id,
        processId: check.id,
        checks: [
          { label: "Is it flat?", ok: true },
          { label: "Are the holes round?", ok: true },
        ],
      }),
      201,
    );
    expect(report).toMatchObject({ passed: 1, outcome: "passed" });

    // Changing the list again leaves that report saying what it was asked.
    await jsonAs(team.admin, "/admin/quality/checklist", put({ checklist: ["Only this now"] }));
    const reports = await jsonAs<Report[]>(team.admin, "/quality-reports");
    expect(reports.find((r) => r.id === report.id)?.checks).toEqual([
      { label: "Is it flat?", ok: true },
      { label: "Are the holes round?", ok: true },
    ]);
  });
});
