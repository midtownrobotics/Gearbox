import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { eventually, onshapeEvent } from "./onshape";
import { newProject, newSubsystem } from "./projects";

// Projects: a team follows several Onshape documents, each linked to one project, and every
// subsystem is in a project, so every part has one. A release goes to its document's project.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;

type Id = { id: number };
type Removal = { outcome: "deleted" | "archived"; name: string; parts: number };
type Document = { id: number; documentId: string; mainAssemblyId: string; projectId: number };

const post = (body?: unknown) => ({ method: "POST", body });
const patch = (body: unknown) => ({ method: "PATCH", body });
const remove = { method: "DELETE" };

describe("projects", () => {
  it("are added, renamed, removed and restored by admins only", async () => {
    const { admin, mentor, student, kioskAdmin } = teamUsers(newTeamId());
    const robot = await newProject(admin, "Robot");
    expect((await callAs(admin, "/projects", post({ name: "Robot" }))).status).toBe(409);
    expect((await callAs(admin, "/projects", post({ name: " " }))).status).toBe(400);
    for (const who of [mentor, student, kioskAdmin]) {
      expect((await callAs(who, "/projects", post({ name: "Mine" }))).status).toBe(403);
      expect((await callAs(who, `/projects/${robot.id}`, patch({ name: "Mine" }))).status).toBe(
        403,
      );
    }
    expect(
      await jsonAs<{ name: string }>(admin, `/projects/${robot.id}`, patch({ name: "2027 Robot" })),
    ).toMatchObject({ name: "2027 Robot" });
    // Everyone signed in sees them.
    expect((await jsonAs<{ name: string }[]>(student, "/projects")).map((p) => p.name)).toEqual([
      "2027 Robot",
    ]);

    // Nothing in it: deleted.
    expect(await jsonAs<Removal>(admin, `/projects/${robot.id}`, remove)).toMatchObject({
      outcome: "deleted",
    });
    expect(await jsonAs(admin, "/projects")).toEqual([]);
  });

  it("are archived while subsystems use them, and then take no new subsystems or parts", async () => {
    const { admin, student } = teamUsers(newTeamId());
    const project = await newProject(admin, "Practice bot");
    const subsystem = await newSubsystem(admin, "Drive", project.id);
    expect(subsystem.projectId).toBe(project.id);

    expect(await jsonAs<Removal>(admin, `/projects/${project.id}`, remove)).toMatchObject({
      outcome: "archived",
    });
    const refused = await callAs(
      admin,
      "/subsystems",
      post({ name: "Arm", projectId: project.id }),
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining("Practice bot") });
    const part = await callAs(
      student,
      "/part-definitions",
      post({ onshapePartNumber: "P-1", revision: "A", subsystemId: subsystem.id, name: "Plate" }),
    );
    expect(part.status).toBe(400);

    await jsonAs(admin, `/projects/${project.id}/restore`, post());
    expect(
      (
        await callAs(
          student,
          "/part-definitions",
          post({
            onshapePartNumber: "P-1",
            revision: "A",
            subsystemId: subsystem.id,
            name: "Plate",
          }),
        )
      ).status,
    ).toBe(201);
  });

  it("are needed for a subsystem, and must be the team's", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    expect((await callAs(a.admin, "/subsystems", post({ name: "Arm" }))).status).toBe(400);
    const theirs = await newProject(b.admin);
    expect(
      (await callAs(a.admin, "/subsystems", post({ name: "Arm", projectId: theirs.id }))).status,
    ).toBe(400);
  });

  it("keep obsoleting older revisions to the part's own project", async () => {
    const { admin, student } = teamUsers(newTeamId());
    const robot = await newSubsystem(admin, "Drive");
    const practice = await newSubsystem(admin, "Drive");
    const make = (subsystemId: number, revision: string) =>
      jsonAs<Id>(
        student,
        "/part-definitions",
        post({
          onshapePartNumber: "SAME-1",
          revision,
          subsystemId,
          name: "Plate",
          obsoleteExisting: true,
        }),
        201,
      );
    const first = await make(robot.id, "A");
    const other = await make(practice.id, "A");
    await make(robot.id, "B");
    const defs = await jsonAs<(Id & { isObsolete: number })[]>(student, "/part-definitions");
    const obsolete = (id: number) => defs.find((d) => d.id === id)?.isObsolete;
    expect(obsolete(first.id)).toBe(1);
    expect(obsolete(other.id)).toBe(0);
  });
});

describe("Onshape documents", () => {
  it("are added with a project, changed and removed", async () => {
    const { admin, mentor } = teamUsers(newTeamId());
    const robot = await newProject(admin);
    const practice = await newProject(admin);
    const id = "0123456789abcdef01234567";
    const assembly = "fedcba9876543210fedcba98";
    // An address pasted from Onshape gives its ids.
    const added = await jsonAs<{ document: Document; webhook: string }>(
      admin,
      "/admin/onshape/documents",
      post({
        documentId: `https://cad.onshape.com/documents/${id}/w/aaaaaaaaaaaaaaaaaaaaaaaa/e/${assembly}`,
        mainAssemblyId: `https://cad.onshape.com/documents/${id}/w/aaaaaaaaaaaaaaaaaaaaaaaa/e/${assembly}`,
        projectId: robot.id,
      }),
      201,
    );
    expect(added).toMatchObject({
      document: { documentId: id, mainAssemblyId: assembly, projectId: robot.id },
      webhook: "needs keys",
    });
    expect(
      (
        await callAs(
          admin,
          "/admin/onshape/documents",
          post({ documentId: id, projectId: robot.id }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await callAs(admin, "/admin/onshape/documents", post({ documentId: "other" }))).status,
    ).toBe(400);
    expect(
      (await callAs(mentor, "/admin/onshape/documents", post({ documentId: "x", projectId: 1 })))
        .status,
    ).toBe(403);

    const moved = await jsonAs<Document>(
      admin,
      `/admin/onshape/documents/${added.document.id}`,
      patch({ projectId: practice.id, mainAssemblyId: "" }),
    );
    expect(moved).toMatchObject({ projectId: practice.id, mainAssemblyId: "" });

    await jsonAs(admin, `/admin/onshape/documents/${added.document.id}`, remove);
    expect(await jsonAs(admin, "/admin/onshape/config")).toMatchObject({ documents: [] });
  });

  it("send each release to its document's project, and Ingest says which", async () => {
    const team = teamUsers(newTeamId());
    const key = `key-${crypto.randomUUID().slice(0, 8)}`;
    await jsonAs(team.admin, "/admin/onshape/config", post({ webhookKeyPrimary: key }));
    const robot = await newProject(team.admin);
    const practice = await newProject(team.admin);
    for (const [documentId, project] of [
      ["doc-robot", robot],
      ["doc-practice", practice],
    ] as const) {
      await jsonAs(
        team.admin,
        "/admin/onshape/documents",
        post({ documentId, projectId: project.id }),
        201,
      );
    }
    const robotSub = await newSubsystem(team.admin, "Drive", robot.id);
    await newSubsystem(team.admin, "Drive", practice.id);

    // The same part number released from both documents.
    for (const [doc, release] of [
      ["doc-robot", "rel-robot"],
      ["doc-practice", "rel-practice"],
    ]) {
      await onshapeEvent(team.teamId, key, {
        event: "onshape.revision.created",
        elementType: 0,
        elementId: "el",
        partNumber: "SAME-1",
        releaseId: release,
        versionId: "ver",
      });
      await onshapeEvent(team.teamId, key, {
        event: "onshape.workflow.transition",
        objectType: "RELEASE",
        transitionName: "RELEASE",
        objectId: release,
        documentId: doc,
        timestamp: new Date().toISOString(),
      });
    }
    const projectOf = (releaseId: string) =>
      database
        .prepare(
          "SELECT project_id AS p FROM onshape_releases WHERE team_id = ? AND release_id = ?",
        )
        .bind(team.teamId, releaseId)
        .first<{ p: number | null }>()
        .then((r) => r?.p);
    await eventually(async () => (await projectOf("rel-practice")) === practice.id);
    expect(await projectOf("rel-robot")).toBe(robot.id);

    type Pending = {
      parts: { partNumber: string; releaseId: number }[];
      releases: { id: number; projectId: number | null }[];
      subsystems: { projectId: number }[];
    };
    const pending = async () => {
      const p = await jsonAs<Pending>(team.student, "/admin/parts/pending");
      return p.parts
        .map((part) => p.releases.find((r) => r.id === part.releaseId)?.projectId)
        .sort();
    };
    // One pending in each project.
    expect(await pending()).toEqual([robot.id, practice.id].sort());

    // Ingesting the robot's leaves the practice bot's waiting.
    await jsonAs(
      team.student,
      "/part-definitions",
      post({ onshapePartNumber: "SAME-1", revision: "A", subsystemId: robotSub.id, name: "Plate" }),
      201,
    );
    expect(await pending()).toEqual([practice.id]);
  });
});
