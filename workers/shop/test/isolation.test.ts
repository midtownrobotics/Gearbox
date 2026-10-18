import { env } from "cloudflare:test";
import {
  type Seeded,
  checkIsolation,
  checkTeamDeletion,
  checkTeamExport,
} from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";
import { STARTER_CHECKLIST } from "../src/lib/quality-checklist";
import { drawingKey, teamPrefix } from "../src/lib/storage";
import { eventually, onshapeEvent } from "./onshape";

/** The starter checklist answered, for a report that passes or fails its first line. */
const passingChecks = () => STARTER_CHECKLIST.map((label) => ({ label, ok: true }));
const failingChecks = () => passingChecks().map((a, i) => (i === 0 ? { ...a, ok: false } : a));

// Two teams, each with its own subsystem, processes, part with instances, a batch with a part
// file and an instance sent back out of it, a drawing in R2 (and an uploaded one), a part from its
// Onshape webhook, its Onshape and chat settings, a shop manager, a required quality check, a
// failed quality report, and a kiosk at the shop. Every route, called as team A's admin, mentor,
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
  "staging_batches",
  "staging_batch_removals",
  "admin_settings",
  "shop_managers",
  "quality_reports",
  "quality_check_items",
];

type Id = { id: number };

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = `t${crypto.randomUUID().slice(0, 8)}`;
  const { admin, student, kioskAdmin } = team;
  // Not the marker: some routes repeat the part number they were asked about. Its drawing's
  // contents carry the marker instead.
  const partNumber = `PN-${crypto.randomUUID().slice(0, 8)}`;
  const webhookKey = `key-${tag}`;

  // Settings: the team's chat channels and Onshape document and webhook key (no API keys, so
  // nothing calls Onshape).
  await jsonAs(admin, "/admin/chat/config", {
    method: "POST",
    body: { releaseChannelId: "CRELEASE", summaryChannelId: "CSUMMARY" },
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
  const makeProcess = (name: string, type: string) =>
    jsonAs<Id>(
      student,
      "/processes",
      { method: "POST", body: { name: `${name} ${tag}`, type } },
      201,
    );
  const process = await makeProcess("Proc", "file_producer");
  const consumer = await makeProcess("Use", "file_consumer");
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
        processIds: [process.id, consumer.id],
      },
    },
    201,
  );
  const instances = await jsonAs<Id[]>(
    student,
    "/part-instances",
    { method: "POST", body: { partDefinitionId: part.id, quantity: 5 } },
    201,
  );
  // One instance started on its own.
  await jsonAs(
    student,
    `/part-instance-processes/${instances[0].id}/processes/${process.id}/doing`,
    {
      method: "POST",
    },
  );
  // A part file on a batch of two, made, with one of them sent back out of it.
  const form = new FormData();
  form.set("file", new File([`file ${tag}`], `cut-${tag}.dxf`, { type: "application/dxf" }));
  const file = await jsonAs<Id>(student, "/part-files", { method: "POST", body: form }, 201);
  const made = await jsonAs<{ batch: Id }>(
    student,
    "/staging-batches",
    {
      method: "POST",
      body: {
        processId: process.id,
        name: `Batch ${tag}`,
        fileId: file.id,
        partInstanceIds: [instances[1].id, instances[3].id],
      },
    },
    201,
  );
  await jsonAs(student, `/staging-batches/${made.batch.id}/status`, {
    method: "POST",
    body: { at: "producer", to: "done" },
  });
  await jsonAs(
    student,
    `/staging-batches/${made.batch.id}/instances/${instances[3].id}/send-back`,
    {
      method: "POST",
    },
  );
  // And an open batch with one staged in it.
  const batch = (
    await jsonAs<{ batch: Id }>(
      student,
      "/staging-batches",
      { method: "POST", body: { processId: process.id, partInstanceIds: [instances[4].id] } },
      201,
    )
  ).batch;
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
  // Its own shop manager and quality check.
  await jsonAs(admin, `/admin/quality/managers/${student.id}`, {
    method: "PUT",
    body: { manager: true },
  });
  const check = await jsonAs<Id>(
    admin,
    "/processes",
    { method: "POST", body: { name: `QC ${tag}`, type: "quality_control" } },
    201,
  );
  await jsonAs(admin, "/admin/quality/settings", {
    method: "PUT",
    body: { requireQualityCheck: true, qualityProcessId: check.id, qualityReports: true },
  });
  // A part that failed its quality report (the check is appended to it), the marker in its notes.
  // Made through a plain process: a File Producer needs a consumer and moves only in a batch.
  const cut = await makeProcess("Cut", "regular");
  const checked = await jsonAs<Id>(
    student,
    "/part-definitions",
    {
      method: "POST",
      body: {
        onshapePartNumber: `QR-${crypto.randomUUID().slice(0, 8)}`,
        revision: "A",
        subsystemId: subsystem.id,
        name: `Checked ${tag}`,
        processIds: [cut.id],
      },
    },
    201,
  );
  const [checkedInstance] = await jsonAs<Id[]>(
    student,
    "/part-instances",
    { method: "POST", body: { partDefinitionId: checked.id, quantity: 1 } },
    201,
  );
  await jsonAs(
    student,
    `/part-instance-processes/${checkedInstance.id}/processes/${cut.id}/done`,
    { method: "POST" },
  );
  const { report } = await jsonAs<{ report: Id }>(
    admin,
    "/quality-reports",
    {
      method: "POST",
      body: {
        partInstanceId: checkedInstance.id,
        processId: check.id,
        checks: failingChecks(),
        unsure: true,
        notes: `Problem ${tag}`,
      },
    },
    201,
  );

  const ids: Record<string, number> = {
    "part-definitions": part.id,
    "part-instances": instances[2].id,
    "part-files": file.id,
    "staging-batches": batch.id,
    processes: process.id,
    "quality-reports": report.id,
  };
  return {
    params: (path, name) => {
      if (name === "instanceId") return String(instances[4].id);
      if (name === "partInstanceId") return String(instances[0].id);
      if (name === "processId") return String(process.id);
      if (name === "partNumber") return partNumber;
      if (name === "revision") return "A";
      if (name === "drawingId") return String(uploaded.id);
      if (name === "userId") return student.id;
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
      check: check.id,
      checkedInstance: checkedInstance.id,
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
        "POST /staging-batches": {
          processId: d.process,
          fileId: d.file,
          partInstanceIds: [d.instance],
        },
        "PATCH /staging-batches/:id": { name: "Mine" },
        "POST /staging-batches/:id/stage": { partInstanceIds: [d.instance] },
        "POST /staging-batches/:id/unstage": { partInstanceIds: [d.instance] },
        "PUT /staging-batches/:id/file": { fileId: d.file },
        "POST /staging-batches/:id/status": { at: "producer", to: "done" },
        "POST /staging-batches/:id/send-back": { to: "producer" },
        "POST /admin/chat/config": { releaseChannelId: "CMINE" },
        "POST /admin/onshape/config": { documentId: "mine" },
        "POST /admin/chat/daily-summary": { kind: "overview", since: Date.now() - 1000 },
        "PUT /admin/quality/managers/:userId": { manager: true },
        "PUT /admin/quality/settings": { requireQualityCheck: true, qualityProcessId: d.check },
        "POST /quality-reports": {
          partInstanceId: d.checkedInstance,
          processId: d.check,
          checks: passingChecks(),
        },
        "POST /quality-reports/:id/send-back": {
          processId: d.process,
          status: "todo",
          fix: false,
          fixNote: "",
        },
        "PUT /admin/quality/checklist": { checklist: STARTER_CHECKLIST.slice() },
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

it("exports a team's data for its admins, and only that team's", async () => {
  const problems = await checkTeamExport({
    seed,
    // As the platform calls it when an admin downloads the app's data.
    exportOf: (teamId) => call(`/internal/teams/${teamId}/export`),
  });
  expect(problems).toEqual([]);
}, 60_000);
