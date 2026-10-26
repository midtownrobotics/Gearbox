import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { newSubsystem } from "./projects";

// Admins remove subsystems and processes the team no longer uses: deleted when nothing points at
// them, archived while parts do, so nothing in use breaks. Archived ones stay out of new parts and
// come back with Restore.

type Id = { id: number };
type Named = Id & { name: string; archivedAt: number | null };
type Removal = { outcome: "deleted" | "archived"; name: string; parts: number };

const post = (body?: unknown) => ({ method: "POST", body });
const put = (body: unknown) => ({ method: "PUT", body });
const remove = { method: "DELETE" };

/** A team of its own with a subsystem and two processes, and a part filed under and made by them. */
async function seed() {
  const team = teamUsers(newTeamId());
  const { admin } = team;
  const subsystem = await newSubsystem(admin, "Arm");
  const mill = await jsonAs<Id>(admin, "/processes", post({ name: "Mill" }), 201);
  const deburr = await jsonAs<Id>(admin, "/processes", post({ name: "Deburr" }), 201);
  const part = await jsonAs<Id>(
    admin,
    "/part-definitions",
    post({
      onshapePartNumber: `PN-${crypto.randomUUID().slice(0, 8)}`,
      revision: "A",
      subsystemId: subsystem.id,
      name: "Plate",
      processIds: [mill.id, deburr.id],
    }),
    201,
  );
  return { team, subsystem, mill, deburr, part };
}

const newPart = (subsystemId: number, processIds: number[]) =>
  post({
    onshapePartNumber: `PN-${crypto.randomUUID().slice(0, 8)}`,
    revision: "A",
    subsystemId,
    name: "New part",
    processIds,
  });

describe("removing subsystems and processes", () => {
  it("deletes one nothing uses", async () => {
    const { admin } = teamUsers(newTeamId());
    const typo = await newSubsystem(admin, "Intkae");
    const old = await jsonAs<Id>(admin, "/processes", post({ name: "Old saw" }), 201);

    expect(await jsonAs<Removal>(admin, `/subsystems/${typo.id}`, remove)).toEqual({
      outcome: "deleted",
      name: "Intkae",
      parts: 0,
    });
    expect(await jsonAs<Removal>(admin, `/processes/${old.id}`, remove)).toMatchObject({
      outcome: "deleted",
    });
    expect(await jsonAs<Named[]>(admin, "/subsystems")).toEqual([]);
    expect(await jsonAs<Named[]>(admin, "/processes")).toEqual([]);
  });

  it("archives one in use, and parts that use it keep it", async () => {
    const { team, subsystem, mill, part } = await seed();
    const { admin } = team;

    expect(await jsonAs<Record<string, unknown>>(admin, "/subsystems/usage")).toEqual({
      [subsystem.id]: { parts: 1, inUse: true },
    });
    expect(await jsonAs<Removal>(admin, `/subsystems/${subsystem.id}`, remove)).toEqual({
      outcome: "archived",
      name: "Arm",
      parts: 1,
    });
    expect(await jsonAs<Removal>(admin, `/processes/${mill.id}`, remove)).toMatchObject({
      outcome: "archived",
      parts: 1,
    });

    // Still listed, by name, for everything that already uses them.
    const subsystems = await jsonAs<Named[]>(team.student, "/subsystems");
    expect(subsystems.find((s) => s.id === subsystem.id)?.archivedAt).toEqual(expect.any(Number));
    const processes = await jsonAs<Named[]>(team.student, "/processes");
    expect(processes.find((p) => p.id === mill.id)?.archivedAt).toEqual(expect.any(Number));
    const blueprint = await jsonAs<{ processId: number }[]>(
      admin,
      `/part-definitions/${part.id}/processes`,
    );
    expect(blueprint.map((b) => b.processId)).toContain(mill.id);
  });

  it("keeps archived ones out of new parts", async () => {
    const { team, subsystem, mill, deburr, part } = await seed();
    const { admin } = team;
    const other = await newSubsystem(admin, "Drive");
    const lathe = await jsonAs<Id>(admin, "/processes", post({ name: "Lathe" }), 201);
    await jsonAs(admin, `/subsystems/${subsystem.id}`, remove);
    await jsonAs(admin, `/processes/${mill.id}`, remove);
    await jsonAs(admin, `/processes/${lathe.id}`, remove);

    // Ingest's subsystem picker.
    const pending = await jsonAs<{ subsystems: Id[] }>(admin, "/admin/parts/pending");
    expect(pending.subsystems.map((s) => s.id)).toEqual([other.id]);

    // A new part can't use either.
    const archivedSubsystem = await callAs(
      admin,
      "/part-definitions",
      newPart(subsystem.id, [deburr.id]),
    );
    expect(archivedSubsystem.status).toBe(400);
    expect(await archivedSubsystem.json()).toEqual({
      error: "Arm was removed on the Admin page. Pick another subsystem.",
    });
    expect(
      (await callAs(admin, "/part-definitions", newPart(other.id, [mill.id, deburr.id]))).status,
    ).toBe(400);
    // Nor can a part be moved to one, or be given one as a new step.
    expect(
      (
        await callAs(admin, `/part-definitions/${part.id}`, {
          method: "PATCH",
          body: { subsystemId: other.id },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callAs(admin, `/part-definitions/${part.id}`, {
          method: "PATCH",
          body: { subsystemId: subsystem.id },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callAs(
          admin,
          `/part-definitions/${part.id}/processes`,
          put({ processIds: [lathe.id] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await callAs(
          admin,
          `/part-definitions/${part.id}/processes`,
          post({ index: 5, processId: lathe.id }),
        )
      ).status,
    ).toBe(400);

    // A part that already has one keeps it when its steps are edited.
    expect(
      (
        await callAs(
          admin,
          `/part-definitions/${part.id}/processes`,
          put({ processIds: [deburr.id, mill.id] }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await callAs(admin, `/part-definitions/${part.id}`, {
          method: "PATCH",
          body: { name: "Plate 2" },
        })
      ).status,
    ).toBe(200);
  });

  it("leaves an archived check out of the Quality Control picker", async () => {
    const { team, mill, part } = await seed();
    const { admin } = team;
    const check = await jsonAs<Id>(
      admin,
      "/processes",
      post({ name: "QC", type: "quality_control" }),
      201,
    );
    await jsonAs(
      admin,
      `/part-definitions/${part.id}/processes`,
      put({ processIds: [mill.id, check.id] }),
    );
    // Chosen, but not required: removing it drops the choice.
    await jsonAs(admin, "/admin/quality/settings", put({ qualityProcessId: check.id }));
    expect(await jsonAs<Removal>(admin, `/processes/${check.id}`, remove)).toMatchObject({
      outcome: "archived",
    });
    const quality = await jsonAs<{ qualityProcessId: number | null; qualityProcesses: Id[] }>(
      admin,
      "/admin/quality",
    );
    expect(quality.qualityProcessId).toBeNull();
    expect(quality.qualityProcesses).toEqual([]);
    expect(
      (
        await callAs(
          admin,
          "/admin/quality/settings",
          put({ requireQualityCheck: true, qualityProcessId: check.id }),
        )
      ).status,
    ).toBe(400);
  });

  it("won't remove the required quality check while it's required", async () => {
    const { admin } = teamUsers(newTeamId());
    const check = await jsonAs<Id>(
      admin,
      "/processes",
      post({ name: "Final check", type: "quality_control" }),
      201,
    );
    await jsonAs(
      admin,
      "/admin/quality/settings",
      put({ requireQualityCheck: true, qualityProcessId: check.id }),
    );
    const res = await callAs(admin, `/processes/${check.id}`, remove);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Require quality control");
    expect((await jsonAs<Named[]>(admin, "/processes"))[0].archivedAt).toBeNull();
  });

  it("restores an archived one for new parts", async () => {
    const { team, subsystem, mill } = await seed();
    const { admin } = team;
    await jsonAs(admin, `/subsystems/${subsystem.id}`, remove);
    await jsonAs(admin, `/processes/${mill.id}`, remove);

    expect(await jsonAs<Named>(admin, `/subsystems/${subsystem.id}/restore`, post())).toMatchObject(
      { id: subsystem.id, archivedAt: null },
    );
    expect(await jsonAs<Named>(admin, `/processes/${mill.id}/restore`, post())).toMatchObject({
      id: mill.id,
      archivedAt: null,
    });
    await jsonAs(admin, "/part-definitions", newPart(subsystem.id, [mill.id]), 201);
    const pending = await jsonAs<{ subsystems: Id[] }>(admin, "/admin/parts/pending");
    expect(pending.subsystems.map((s) => s.id)).toContain(subsystem.id);
  });

  it("is only for admins, never a kiosk", async () => {
    const { team, subsystem, mill } = await seed();
    for (const who of [team.student, team.mentor, team.kioskAdmin]) {
      for (const [path, init] of [
        ["/subsystems", post({ name: "Mine" })],
        ["/processes", post({ name: "Mine" })],
        [`/subsystems/${subsystem.id}`, remove],
        [`/processes/${mill.id}`, remove],
        [`/subsystems/${subsystem.id}/restore`, post()],
        [`/processes/${mill.id}/restore`, post()],
        ["/subsystems/usage", undefined],
        ["/processes/usage", undefined],
      ] as const) {
        expect((await callAs(who, path, init)).status, `${who.id} ${path}`).toBe(403);
      }
    }
    expect((await jsonAs<Named[]>(team.admin, "/subsystems"))[0].archivedAt).toBeNull();
  });

  it("can't touch another team's", async () => {
    const { team, subsystem, mill } = await seed();
    const other = teamUsers(newTeamId()).admin;
    for (const path of [`/subsystems/${subsystem.id}`, `/processes/${mill.id}`]) {
      expect((await callAs(other, path, remove)).status).toBe(404);
      expect((await callAs(other, `${path}/restore`, post())).status).toBe(404);
    }
    expect((await jsonAs<Named[]>(team.admin, "/subsystems")).map((s) => s.archivedAt)).toEqual([
      null,
    ]);
    expect(
      (await jsonAs<Named[]>(team.admin, "/processes")).find((p) => p.id === mill.id)?.archivedAt,
    ).toBeNull();
  });
});
