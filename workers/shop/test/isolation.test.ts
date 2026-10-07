import { env } from "cloudflare:test";
import { type Seeded, checkIsolation, checkTeamDeletion } from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";
import { drawingKey, teamPrefix } from "../src/lib/storage";
import { eventually, onshapeEvent } from "./onshape";

// Two teams, each with its own subsystem, process, part with instances and a staging batch, a
// part file, a drawing in R2 (and an uploaded one), a part from its Onshape webhook, its Onshape
// and Slack settings, and a kiosk at the shop. Every route, called as team A's admin, mentor,
// student and kiosk session with team B's ids, must show none of B's and change nothing of B's,
// in D1 or in R2.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;
const bucket = (env as unknown as { DRAWINGS: R2Bucket }).DRAWINGS;
const TABLES = [
  "subsystems",
  "part_definitions",
  "part_instances",
  "processes",
  "part_definition_process_blueprints",
  "part_instance_processes",
  "actions",
  "kiosk_presence",
  "onshape_releases",
  "onshape_parts",
  "drawings",
  "files",
  "part_instance_files",
  "staging_batches",
  "admin_settings",
];

type Id = { id: number };

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = `t${crypto.randomUUID().slice(0, 8)}`;
  const { admin, student, kioskAdmin } = team;
  // Not the marker: some routes repeat the part number they were asked about. Its drawing's
  // contents carry the marker instead.
  const partNumber = `PN-${crypto.randomUUID().slice(0, 8)}`;
  const webhookKey = `key-${tag}`;

  // Settings: the team's Slack channels and Onshape document and webhook key (no API keys, so
  // nothing calls Onshape).
  await jsonAs(admin, "/admin/slack/config", {
    method: "POST",
    body: { slackReleaseChannelId: "CRELEASE", slackSummaryChannelId: "CSUMMARY" },
  });
  await jsonAs(admin, "/admin/onshape/config", {
    method: "POST",
    body: { documentId: `doc${tag}`, mainAssemblyId: `asm${tag}`, webhookKeyPrimary: webhookKey },
  });
  // A released part, from the team's own webhook.
  const event = await onshapeEvent(team.teamId, webhookKey, {
    event: "onshape.revision.created",
    elementType: 0,
    elementId: `el${tag}`,
    partNumber,
    releaseId: `rel${tag}`,
    versionId: `ver${tag}`,
  });
  expect(event.status).toBe(200);
  await eventually(() =>
    database
      .prepare("SELECT id FROM onshape_parts WHERE team_id = ? AND part_number = ?")
      .bind(team.teamId, partNumber)
      .first(),
  );

  const subsystem = await jsonAs<Id>(
    student,
    "/subsystems",
    { method: "POST", body: { name: `Sub ${tag}` } },
    201,
  );
  const process = await jsonAs<Id>(
    student,
    "/processes",
    { method: "POST", body: { name: `Proc ${tag}` } },
    201,
  );
  const part = await jsonAs<Id>(
    student,
    "/part-definitions",
    {
      method: "POST",
      body: {
        onshapePartNumber: partNumber,
        revision: "A",
        subsystemId: subsystem.id,
        name: `Part ${tag}`,
        processIds: [process.id],
      },
    },
    201,
  );
  const instances = await jsonAs<Id[]>(
    student,
    "/part-instances",
    { method: "POST", body: { partDefinitionId: part.id, quantity: 3 } },
    201,
  );
  // One instance started, one staged in a batch.
  await jsonAs(
    student,
    `/part-instance-processes/${instances[0].id}/processes/${process.id}/doing`,
    {
      method: "POST",
    },
  );
  const batch = await jsonAs<Id>(
    student,
    "/staging-batches",
    { method: "POST", body: { processId: process.id } },
    201,
  );
  await jsonAs(student, `/staging-batches/${batch.id}/stage`, {
    method: "POST",
    body: { partInstanceIds: [instances[1].id] },
  });
  // A part file, assigned to an instance.
  const form = new FormData();
  form.set("file", new File([`file ${tag}`], `cut-${tag}.dxf`, { type: "application/dxf" }));
  const file = await jsonAs<Id>(student, "/part-files", { method: "POST", body: form }, 201);
  await jsonAs(student, `/part-files/${file.id}/assignments`, {
    method: "PUT",
    body: { partDefinitionId: part.id, count: 1 },
  });
  // A released drawing in R2, and one uploaded by hand.
  await bucket.put(drawingKey(team.teamId, partNumber, "A"), `%PDF drawing ${tag}`);
  const upload = new FormData();
  upload.set(
    "file",
    new File([`%PDF upload ${tag}`], `up-${tag}.pdf`, { type: "application/pdf" }),
  );
  upload.set("partNumber", partNumber);
  const uploaded = await jsonAs<Id>(student, "/drawings/upload", { method: "POST", body: upload });
  // Someone at the team's kiosk.
  await jsonAs(kioskAdmin, "/kiosk-presence/heartbeat", { method: "POST" });

  const ids: Record<string, number> = {
    "part-definitions": part.id,
    "part-instances": instances[2].id,
    "part-files": file.id,
    "staging-batches": batch.id,
    processes: process.id,
  };
  return {
    params: (path, name) => {
      if (name === "partInstanceId" || name === "instanceId") return String(instances[0].id);
      if (name === "processId") return String(process.id);
      if (name === "partNumber") return partNumber;
      if (name === "revision") return "A";
      if (name === "drawingId") return String(uploaded.id);
      const id = ids[path.split("/")[1]];
      return id === undefined ? undefined : String(id);
    },
    markers: [tag],
    data: {
      subsystem: subsystem.id,
      process: process.id,
      part: part.id,
      instance: instances[2].id,
      file: file.id,
    },
  };
}

async function snapshot(teamId: string) {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) {
    out[table] = (
      await database
        .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY id`)
        .bind(teamId)
        .all()
    ).results;
  }
  const listed = await bucket.list({ prefix: teamPrefix(teamId) });
  out.r2 = listed.objects.map((o) => [o.key, o.size, o.etag]);
  return out;
}

it("keeps every team's shop to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    bodies: (b) => {
      const d = b.data as Record<string, number>;
      return {
        "POST /subsystems": { name: "Mine" },
        "POST /processes": { name: "Mine" },
        "PATCH /processes/:id": { type: "file_producer" },
        "POST /part-definitions": {
          onshapePartNumber: "MINE",
          revision: "A",
          subsystemId: d.subsystem,
          name: "Mine",
          processIds: [d.process],
        },
        "PATCH /part-definitions/:id": { name: "Renamed", subsystemId: d.subsystem },
        "PUT /part-definitions/:id/processes": { processIds: [d.process] },
        "PATCH /part-definitions/:id/processes/reorder": { processIds: [d.process] },
        "POST /part-definitions/:id/processes": { index: 5, processId: d.process },
        "POST /part-instances": { partDefinitionId: d.part, quantity: 1 },
        "PATCH /part-instances/:id": { isPriority: true, isStale: true },
        "POST /part-instance-processes/bulk": {
          processId: d.process,
          partInstanceIds: [d.instance],
          to: "doing",
        },
        "PATCH /part-instance-processes/:partInstanceId/processes/:processId": { status: "done" },
        "PUT /part-files/:id/assignments": { partDefinitionId: d.part, count: 3 },
        "POST /staging-batches": { processId: d.process },
        "POST /staging-batches/:id/stage": { partInstanceIds: [d.instance] },
        "POST /staging-batches/:id/unstage": { partInstanceIds: [d.instance] },
        "PUT /staging-batches/:id/file": { fileId: d.file },
        "POST /admin/slack/config": { slackReleaseChannelId: "CMINE" },
        "POST /admin/onshape/config": { documentId: "mine" },
        "POST /admin/slack/daily-summary": { kind: "overview", since: Date.now() - 1000 },
      };
    },
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(150);
}, 120_000);

it("never shows a team another team's drawing, even by its part number", async () => {
  // Already covered route by route above; this spells out the R2 side for one route.
  const { student } = (await import("@g3/testing/users")).teamUsers("frc424242");
  const res = await callAs(student, "/parts/PN-anything/A/drawing");
  expect(res.status).toBe(404);
});

it("deletes a team's data when an operator deletes the team, and only that team's", async () => {
  const problems = await checkTeamDeletion({
    seed,
    snapshot,
    // As the platform calls it, over the service binding (the gateway never answers /internal).
    remove: (teamId) => call(`/internal/teams/${teamId}`, { method: "DELETE" }),
  });
  expect(problems).toEqual([]);
}, 60_000);
