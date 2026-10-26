import { inTeam, withTeam } from "@g3/auth";
import { DEMO_PEOPLE, type DemoPerson, SAFE_TEXT, vocabularyOf } from "@g3/demo";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createShopDb } from "./db";
import {
  actions,
  onshapeParts,
  onshapeReleases,
  partDefinitionProcessBlueprints,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
  processes,
  qualityReports,
  shopManagers,
  stagingBatches,
  subsystems,
} from "./db/schema";
import { storeDrawingInR2 } from "./lib/onshape-export";
import { STARTER_CHECKLIST, saveChecklist } from "./lib/quality-checklist";
import { SETTING, setSetting } from "./lib/settings";
import type { AppEnv } from "./types";

// The public demo's Shop (roadmap 5.3), loaded after its nightly reset: parts partway through
// production, each step in every state, two batches (one being programmed in CAM, one programmed
// and waiting for the router), a required quality check with reports (one part passed, one failed
// and waiting for a shop manager to decide what to do with it), and a release from Onshape waiting
// on Ingest. The demo has no
// Onshape, so a release is made here (`addDemoRelease`, also the Ingest page's "Add a sample
// release"), and every drawing is a one-page PDF saying a drawing would be there. No part files:
// uploads are off in the demo.

type Status = "waiting" | "todo" | "doing" | "done";
type Env = AppEnv["Bindings"];

const SUBSYSTEMS = ["Drivetrain", "Intake", "Climber", "Electrical"];

const PROCESSES = [
  { name: "CAM", type: "file_producer" },
  { name: "Router", type: "file_consumer" },
  { name: "Lathe", type: "regular" },
  { name: "Deburr", type: "regular" },
  { name: "Assembly", type: "regular" },
  { name: "Quality check", type: "quality_control" },
] as const;

/** The required quality check: the last process, at the end of every part. */
const CHECK = PROCESSES.length - 1;

/**
 * Each part: its subsystem and processes (by place in the lists above, before the quality check
 * every part ends with) and each instance's progress.
 */
const PART_PLANS: {
  number: string;
  name: string;
  subsystem: number;
  material: string;
  thickness?: string;
  steps: number[];
  /** How far each instance is: steps done, and whether the next is being worked on. */
  instances: [done: number, doing: boolean][];
  /** Its instances' CAM steps carry this batch (1 or 2). */
  batch?: number;
  /** Quality reports on its instances, by instance (from 0): passed, or failed and waiting. */
  reports?: Record<number, "passed" | "failed">;
}[] = [
  {
    number: "DEMO-1001",
    name: "Side plate",
    subsystem: 0,
    material: "Aluminum 6061",
    thickness: "1/8 in",
    steps: [0, 1, 3],
    instances: [
      [0, true],
      [0, true],
    ],
    batch: 1,
  },
  {
    number: "DEMO-1002",
    name: "Motor plate",
    subsystem: 0,
    material: "Aluminum 6061",
    thickness: "1/4 in",
    steps: [0, 1, 3],
    instances: [
      [1, false],
      [1, false],
      [1, false],
    ],
    batch: 2,
  },
  {
    number: "DEMO-1003",
    name: "Gusset",
    subsystem: 1,
    material: "Aluminum 6061",
    thickness: "1/8 in",
    steps: [0, 1, 3],
    instances: [
      [3, false],
      [2, true],
      [0, false],
      [0, false],
    ],
  },
  {
    number: "DEMO-1004",
    name: "Hex shaft spacer",
    subsystem: 1,
    material: "Delrin",
    steps: [2, 3],
    instances: [
      [2, false],
      [1, true],
      [0, true],
      [0, false],
    ],
  },
  {
    number: "DEMO-1005",
    name: "Climber hook",
    subsystem: 2,
    material: "Steel",
    steps: [2, 3, 4],
    instances: [
      [1, false],
      [0, false],
    ],
  },
  {
    number: "DEMO-1006",
    name: "Battery mount",
    subsystem: 3,
    material: "Polycarbonate",
    thickness: "1/16 in",
    steps: [0, 1, 4],
    instances: [[0, false]],
  },
  {
    number: "DEMO-1007",
    name: "Intake roller",
    subsystem: 1,
    material: "Polycarbonate",
    steps: [2, 3],
    // Checked and passed; failed and waiting at the check; waiting for its check.
    instances: [
      [3, false],
      [2, false],
      [2, false],
    ],
    reports: { 0: "passed", 1: "failed" },
  },
];

const PARTS = PART_PLANS.map((part) => ({ ...part, steps: [...part.steps, CHECK] }));

const processName = (step: number) => (PROCESSES[step] as (typeof PROCESSES)[number]).name;

/** The parts each sample release brings, in turn: name, material and quantity. */
const RELEASE_PARTS = [
  { name: "Bumper bracket", quantity: 4 },
  { name: "Shooter flywheel", quantity: 2 },
  { name: "Intake roller", quantity: 2 },
  { name: "Climber hook", quantity: 2 },
  { name: "Battery mount", quantity: 1 },
  { name: "Gusset", quantity: 8 },
];

/** A drawing's stand-in: one page with its part number, revision and name. */
async function drawingPdf(partNumber: string, revision: string, name: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([792, 612]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const gray = rgb(0.4, 0.4, 0.4);
  page.drawRectangle({ x: 24, y: 24, width: 744, height: 564, borderColor: gray, borderWidth: 1 });
  page.drawText("Drawing PDF would be here", { x: 220, y: 330, size: 28, font: bold });
  page.drawText(`${partNumber} · Rev ${revision} · ${name}`, {
    x: 220,
    y: 296,
    size: 14,
    font,
    color: gray,
  });
  return pdf.save();
}

/** Puts a part revision's stand-in drawing where Onshape's would go (stamped with its barcode). */
async function storeDrawing(
  env: Env,
  teamId: string,
  partNumber: string,
  revision: string,
  name: string,
) {
  const pdf = await drawingPdf(partNumber, revision, name);
  await storeDrawingInR2(env, teamId, partNumber, revision, pdf.buffer as ArrayBuffer);
}

/**
 * A new release as Onshape's webhook would bring it: three parts waiting on Ingest, each with a
 * drawing. Each one has the next number, and its parts are the next on the list.
 */
export async function addDemoRelease(env: Env, teamId: string) {
  const db = createShopDb(env.SHOP_DB);
  const done = await db
    .select({ id: onshapeReleases.id })
    .from(onshapeReleases)
    .where(inTeam(onshapeReleases, teamId))
    .all();
  const n = done.length + 1;
  const now = Math.floor(Date.now() / 1000);
  const madeBy = DEMO_PEOPLE[5] as DemoPerson;
  const approver = DEMO_PEOPLE[1] as DemoPerson;
  const releaseId = `demo-release-${n}`;
  const at = new Date(now * 1000).toISOString();
  const [release] = await db
    .insert(onshapeReleases)
    .values(
      withTeam(teamId, {
        releaseId,
        timestamp: at,
        createdAt: now,
        name: `Release ${n}`,
        notes: SAFE_TEXT.note[n % SAFE_TEXT.note.length],
        state: "RELEASED",
        madeBy: madeBy.name,
        madeAt: at,
        approvers: [{ name: approver.name, approvedAt: at, rejectedAt: null }],
        comments: [],
        detailsAt: now,
      }),
    )
    .returning({ id: onshapeReleases.id });
  const parts = [0, 1, 2].map((i) => {
    const part = RELEASE_PARTS[
      ((n - 1) * 3 + i) % RELEASE_PARTS.length
    ] as (typeof RELEASE_PARTS)[number];
    return { ...part, partNumber: `DEMO-${2000 + (n - 1) * 3 + i + 1}` };
  });
  for (const part of parts) {
    await db.insert(onshapeParts).values(
      withTeam(teamId, {
        entityId: `demo-part-${part.partNumber}`,
        partDrawingEntityId: `demo-drawing-${part.partNumber}`,
        onshapeReleaseId: releaseId,
        releaseId: release.id,
        partNumber: part.partNumber,
        versionId: releaseId,
        quantity: part.quantity,
        revision: "A",
        name: part.name,
        createdAt: now,
      }),
    );
    await storeDrawing(env, teamId, part.partNumber, "A", part.name);
  }
  return { release: release.id, parts: parts.length };
}

export async function loadDemo(env: Env, teamId: string) {
  const db = createShopDb(env.SHOP_DB);
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const designer = DEMO_PEOPLE[5] as DemoPerson;
  const machinist = DEMO_PEOPLE[0] as DemoPerson;
  const mentor = DEMO_PEOPLE[1] as DemoPerson;
  const checker = DEMO_PEOPLE[3] as DemoPerson;

  const subsystemIds: number[] = [];
  for (const name of SUBSYSTEMS) {
    const [row] = await db
      .insert(subsystems)
      .values(withTeam(teamId, { name, createdAt: now - 30 * 24 * HOUR }))
      .returning({ id: subsystems.id });
    subsystemIds.push(row.id);
  }
  const processIds: number[] = [];
  for (const process of PROCESSES) {
    const [row] = await db
      .insert(processes)
      .values(withTeam(teamId, { ...process, createdAt: now - 30 * 24 * HOUR }))
      .returning({ id: processes.id });
    processIds.push(row.id);
  }

  // Quality control: required at the end of every part, finished with a report against the
  // starter checklist, by the shop managers (the mentor visitors sign in as, and a student).
  for (const manager of [mentor, checker]) {
    await db.insert(shopManagers).values(
      withTeam(teamId, {
        userId: manager.id,
        addedBy: mentor.id,
        addedAt: Math.floor((now - 20 * 24 * HOUR) / 1000),
      }),
    );
  }
  await setSetting(db, teamId, SETTING.qualityCheckProcess, String(processIds[CHECK]));
  await setSetting(db, teamId, SETTING.qualityCheckRequired, "1");
  await setSetting(db, teamId, SETTING.qualityReports, "1");
  await saveChecklist(db, teamId, [...STARTER_CHECKLIST]);

  const batchIds = new Map<number, number>();
  for (const number of [1, 2]) {
    const [row] = await db
      .insert(stagingBatches)
      .values(
        withTeam(teamId, {
          number,
          processId: processIds[0] as number,
          consumerProcessId: processIds[1] as number,
          producerStatus: number === 1 ? "doing" : "done",
          consumerStatus: "todo",
          createdBy: machinist.id,
          createdAt: now - (number === 1 ? 2 : 6) * HOUR,
          completedAt: number === 2 ? now - 4 * HOUR : null,
        }),
      )
      .returning({ id: stagingBatches.id });
    batchIds.set(number, row.id);
  }

  let instances = 0;
  for (const [p, part] of PARTS.entries()) {
    const createdAt = now - (10 - p) * 24 * HOUR;
    const [definition] = await db
      .insert(partDefinitions)
      .values(
        withTeam(teamId, {
          onshapePartNumber: part.number,
          revision: "A",
          subsystemId: subsystemIds[part.subsystem] as number,
          creator: designer.name,
          name: part.name,
          notes: SAFE_TEXT.note[p % SAFE_TEXT.note.length],
          material: part.material,
          thickness: part.thickness ?? null,
          createdAt,
        }),
      )
      .returning({ id: partDefinitions.id });
    for (const [index, step] of part.steps.entries()) {
      await db.insert(partDefinitionProcessBlueprints).values(
        withTeam(teamId, {
          partDefinitionId: definition.id,
          processId: processIds[step] as number,
          index,
          createdAt,
        }),
      );
    }
    for (const [n, [done, doing]] of part.instances.entries()) {
      const [instance] = await db
        .insert(partInstances)
        .values(
          withTeam(teamId, {
            partDefinitionId: definition.id,
            instanceNumber: n + 1,
            isPriority: p === 0 && n === 0 ? 1 : 0,
            createdAt,
          }),
        )
        .returning({ id: partInstances.id });
      instances++;
      const finished: { processId: number; name: string; completedAt: number | null }[] = [];
      for (const [index, step] of part.steps.entries()) {
        const status: Status =
          index < done ? "done" : index === done ? (doing ? "doing" : "todo") : "waiting";
        const completedAt = status === "done" ? now - (part.steps.length - index) * HOUR : null;
        const processId = processIds[step] as number;
        await db.insert(partInstanceProcesses).values(
          withTeam(teamId, {
            partInstanceId: instance.id,
            processId,
            index,
            status,
            completedAt,
            createdAt,
            batchId: step === 0 && part.batch ? (batchIds.get(part.batch) ?? null) : null,
          }),
        );
        if (status === "done" || status === "doing") {
          await db.insert(actions).values(
            withTeam(teamId, {
              userId: step === CHECK ? checker.id : machinist.id,
              partInstanceId: instance.id,
              processId,
              action: status === "done" ? "completed" : "started",
              createdAt: completedAt ?? now - HOUR,
            }),
          );
        }
        if (status === "done" && step !== CHECK) {
          finished.push({ processId, name: processName(step), completedAt });
        }
      }
      const result = part.reports?.[n];
      if (result) {
        const passed = result === "passed";
        const reportedAt = passed ? now - HOUR / 2 : now - HOUR / 4;
        const suspect = finished[finished.length - 1];
        await db.insert(qualityReports).values(
          withTeam(teamId, {
            partInstanceId: instance.id,
            partDefinitionId: definition.id,
            partName: part.name,
            partNumber: part.number,
            revision: "A",
            instanceNumber: n + 1,
            processId: processIds[CHECK] as number,
            processName: processName(CHECK),
            reportedBy: checker.id,
            createdAt: reportedAt,
            // A failed part is the wrong thickness, most likely from its last step.
            checks: STARTER_CHECKLIST.map((label, i) => ({ label, ok: passed || i !== 1 })),
            passed: passed ? 1 : 0,
            suspects: passed || !suspect ? [] : [{ ...suspect, completedBy: machinist.id }],
            notes: passed ? SAFE_TEXT.note[0] : SAFE_TEXT.note[1],
            outcome: passed ? "passed" : "not_sent_back",
            outcomeBy: passed ? checker.id : null,
            outcomeAt: passed ? reportedAt : null,
          }),
        );
      }
    }
  }
  for (const part of PARTS) await storeDrawing(env, teamId, part.number, "A", part.name);
  await addDemoRelease(env, teamId);
  return { parts: PARTS.length, instances };
}

/** The words in the demo's Shop data, for the gateway. */
export const demoWords = (): string[] =>
  vocabularyOf(SUBSYSTEMS, PROCESSES, PARTS, RELEASE_PARTS, STARTER_CHECKLIST, "Release");
