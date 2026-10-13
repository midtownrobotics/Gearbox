import { admin, kioskAdmin, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import type { Batch, DuplicatePlan, StoredFile } from "../src/lib/batches";
import { fileStepError } from "../src/lib/process-rules";

// Batches (src/lib/batches.ts): instances that share a file, moved as one unit through the File
// Producer process that makes it and the File Consumer process that uses it.

type Id = { id: number };
type Step = {
  partInstanceId: number;
  processId: number;
  index: number;
  status: string;
  batchId: number | null;
};
type Made = { batch: Batch; refused: string[] };

const post = (body?: unknown) => ({ method: "POST", body });

/** Its own CAM (makes files) → Router (uses them) → Deburr, and a part that goes through them. */
async function shop() {
  const tag = crypto.randomUUID().slice(0, 8);
  const subsystem = await jsonAs<Id>(student, "/subsystems", post({ name: `Arm ${tag}` }), 201);
  const make = (name: string, type: string) =>
    jsonAs<Id>(student, "/processes", post({ name: `${name} ${tag}`, type }), 201);
  const cam = await make("CAM", "file_producer");
  const router = await make("Router", "file_consumer");
  const laser = await make("Laser", "file_consumer");
  const deburr = await make("Deburr", "regular");

  /** A part of its own with `quantity` instances, going CAM → `then` → Deburr. */
  async function part(name: string, quantity: number, then = router) {
    const definition = await jsonAs<Id>(
      student,
      "/part-definitions",
      post({
        onshapePartNumber: `${name}-${crypto.randomUUID().slice(0, 8)}`,
        revision: "A",
        subsystemId: subsystem.id,
        name,
        processIds: [cam.id, then.id, deburr.id],
      }),
      201,
    );
    const instances = await jsonAs<Id[]>(
      student,
      "/part-instances",
      post({ partDefinitionId: definition.id, quantity }),
      201,
    );
    return { definition, ids: instances.map((i) => i.id) };
  }

  async function upload(name = `nest-${crypto.randomUUID().slice(0, 8)}.nc`) {
    const form = new FormData();
    form.set("file", new File(["G-code"], name, { type: "text/plain" }));
    return jsonAs<StoredFile>(student, "/part-files", { method: "POST", body: form }, 201);
  }

  /** An instance's status at each of its three processes, in order. */
  async function statuses(instanceId: number) {
    const steps = await jsonAs<Step[]>(
      student,
      `/part-instance-processes?partInstanceId=${instanceId}`,
    );
    return steps
      .sort((a, b) => a.index - b.index)
      .map((step) => step.status)
      .join(" ");
  }

  const batch = async (id: number) =>
    (await jsonAs<Batch[]>(student, "/staging-batches")).find((b) => b.id === id) as Batch;
  const move = (id: number, at: "producer" | "consumer", to: "doing" | "done") =>
    callAs(student, `/staging-batches/${id}/status`, post({ at, to }));
  const newBatch = (body: Record<string, unknown> = {}) =>
    jsonAs<Made>(student, "/staging-batches", post({ processId: cam.id, ...body }), 201);

  return { cam, router, laser, deburr, part, upload, statuses, batch, move, newBatch };
}

const error = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("a File Producer process without a batch", () => {
  it("moves a part on its own, with no file", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 1);
    const step = `/part-instance-processes/${ids[0]}/processes/${s.cam.id}`;
    expect((await callAs(student, `${step}/doing`, post())).status).toBe(200);
    expect(await s.statuses(ids[0])).toBe("doing waiting waiting");
    expect((await callAs(student, `${step}/done`, post())).status).toBe(200);
    expect(await s.statuses(ids[0])).toBe("done todo waiting");
  });
});

describe("making a batch", () => {
  it("makes one by linking a file to instances, named for its part and how many", async () => {
    const s = await shop();
    const { definition, ids } = await s.part("Plate", 3);
    const file = await s.upload();
    const { batch, refused } = await s.newBatch({
      fileId: file.id,
      partInstanceIds: ids.slice(0, 2),
    });
    expect(refused).toEqual([]);
    expect(batch).toMatchObject({
      label: "Plate × 2",
      name: null,
      processId: s.cam.id,
      consumerProcessId: s.router.id,
      producerStatus: "todo",
      file: { id: file.id, obsolete: false },
    });
    expect(batch.instances).toEqual(
      ids.slice(0, 2).map((partInstanceId) =>
        expect.objectContaining({
          partInstanceId,
          partDefinitionId: definition.id,
          removedAt: null,
        }),
      ),
    );
    // In the batch, not started; the third is untouched.
    expect(await s.statuses(ids[0])).toBe("todo waiting waiting");
    const steps = await jsonAs<Step[]>(student, `/part-instance-processes?processId=${s.cam.id}`);
    expect(steps.filter((p) => p.batchId === batch.id).map((p) => p.partInstanceId)).toEqual(
      ids.slice(0, 2),
    );
  });

  it("numbers an empty or mixed batch, and takes a name", async () => {
    const s = await shop();
    const plates = await s.part("Plate", 1);
    const gussets = await s.part("Gusset", 1);
    const { batch } = await s.newBatch();
    expect(batch.label).toBe(`Batch ${batch.number}`);
    const next = (await s.newBatch()).batch;
    expect(next.number).toBe(batch.number + 1);

    await jsonAs(
      student,
      `/staging-batches/${batch.id}/stage`,
      post({ partInstanceIds: [...plates.ids, ...gussets.ids] }),
    );
    expect((await s.batch(batch.id)).label).toBe(`Batch ${batch.number}`);

    const rename = (name: string | null) =>
      jsonAs<Batch>(student, `/staging-batches/${batch.id}`, { method: "PATCH", body: { name } });
    expect((await rename("  Sheet 3  ")).label).toBe("Sheet 3");
    expect((await rename("")).label).toBe(`Batch ${batch.number}`);
    expect(
      (
        await callAs(student, `/staging-batches/${batch.id}`, {
          method: "PATCH",
          body: { name: "x".repeat(81) },
        })
      ).status,
    ).toBe(400);
  });

  it("is only made at a File Producer process, and leaves nothing behind when nothing fits", async () => {
    const s = await shop();
    expect(
      (await callAs(student, "/staging-batches", post({ processId: s.router.id }))).status,
    ).toBe(409);

    // A part that has already finished CAM can't be linked to a file.
    const { ids } = await s.part("Plate", 1);
    await callAs(student, `/part-instance-processes/${ids[0]}/processes/${s.cam.id}/done`, post());
    const before = (await jsonAs<Batch[]>(student, "/staging-batches")).length;
    const res = await callAs(
      student,
      "/staging-batches",
      post({ processId: s.cam.id, partInstanceIds: ids }),
    );
    expect(res.status).toBe(409);
    expect(await error(res)).toMatch(/has finished CAM/);
    expect((await jsonAs<Batch[]>(student, "/staging-batches")).length).toBe(before);
  });

  it("keeps a batch to parts headed for the same File Consumer process", async () => {
    const s = await shop();
    const routed = await s.part("Plate", 1);
    const lasered = await s.part("Shim", 1, s.laser);
    const { batch } = await s.newBatch({ partInstanceIds: routed.ids });
    const res = await callAs(
      student,
      `/staging-batches/${batch.id}/stage`,
      post({ partInstanceIds: lasered.ids }),
    );
    expect(res.status).toBe(409);
    expect(await error(res)).toMatch(/goes to Laser .* next, and this batch is for Router/);
  });

  it("won't let a kiosk choose a batch's file", async () => {
    const s = await shop();
    const file = await s.upload();
    const { batch } = await s.newBatch();
    expect(
      (
        await callAs(kioskAdmin, `/staging-batches/${batch.id}/file`, {
          method: "PUT",
          body: { fileId: file.id },
        })
      ).status,
    ).toBe(403);
    expect(
      (await callAs(kioskAdmin, "/staging-batches", post({ processId: s.cam.id, fileId: file.id })))
        .status,
    ).toBe(403);
  });
});

describe("a batch at its File Producer process", () => {
  it("gives its status to what's added, and To Do to what's taken out", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 3);
    const { batch } = await s.newBatch({ partInstanceIds: [ids[0]] });
    expect((await s.move(batch.id, "producer", "doing")).status).toBe(200);
    expect(await s.statuses(ids[0])).toBe("doing waiting waiting");

    await jsonAs(
      student,
      `/staging-batches/${batch.id}/stage`,
      post({ partInstanceIds: [ids[1]] }),
    );
    expect(await s.statuses(ids[1])).toBe("doing waiting waiting");

    await jsonAs(
      student,
      `/staging-batches/${batch.id}/unstage`,
      post({ partInstanceIds: [ids[1]] }),
    );
    expect(await s.statuses(ids[1])).toBe("todo waiting waiting");
    expect((await s.batch(batch.id)).instances.map((i) => i.partInstanceId)).toEqual([ids[0]]);

    // One that's in another batch stays there.
    const other = (await s.newBatch({ partInstanceIds: [ids[2]] })).batch;
    const res = await callAs(
      student,
      `/staging-batches/${batch.id}/stage`,
      post({ partInstanceIds: [ids[2]] }),
    );
    expect(res.status).toBe(409);
    expect(await error(res)).toMatch(/already in another batch/);
    expect((await s.batch(other.id)).instances).toHaveLength(1);
  });

  it("can't be started or completed empty", async () => {
    const s = await shop();
    const { batch } = await s.newBatch();
    expect((await s.move(batch.id, "producer", "doing")).status).toBe(409);
    expect((await s.move(batch.id, "producer", "done")).status).toBe(409);
  });

  it("moves its parts only as one", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 2);
    const { batch } = await s.newBatch({ partInstanceIds: ids });
    for (const processId of [s.cam.id, s.router.id]) {
      const step = `/part-instance-processes/${ids[0]}/processes/${processId}`;
      for (const res of [
        await callAs(student, `${step}/doing`, post()),
        await callAs(student, `${step}/done`, post()),
        await callAs(student, step, { method: "PATCH", body: { status: "done" } }),
      ]) {
        expect(res.status).toBe(409);
        expect(await error(res)).toMatch(/is in the batch "Plate × 2"/);
      }
    }
    const bulk = await jsonAs<{ moved: number }>(
      student,
      "/part-instance-processes/bulk",
      post({ processId: s.cam.id, partInstanceIds: ids, to: "doing" }),
    );
    expect(bulk.moved).toBe(0);
    expect(await s.statuses(ids[0])).toBe("todo waiting waiting");
    expect(batch.producerStatus).toBe("todo");
  });

  it("completes without a file, and then takes no more parts until it's sent back", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 3);
    const { batch } = await s.newBatch({ partInstanceIds: ids.slice(0, 2) });
    expect((await s.move(batch.id, "producer", "done")).status).toBe(200);
    expect(await s.statuses(ids[0])).toBe("done todo waiting");
    expect(await s.batch(batch.id)).toMatchObject({
      producerStatus: "done",
      consumerStatus: "todo",
      file: null,
    });

    const stage = () =>
      callAs(student, `/staging-batches/${batch.id}/stage`, post({ partInstanceIds: [ids[2]] }));
    const refused = await stage();
    expect(refused.status).toBe(409);
    expect(await error(refused)).toMatch(/Send the whole batch back/);
    expect(
      (
        await callAs(
          student,
          `/staging-batches/${batch.id}/unstage`,
          post({ partInstanceIds: [ids[0]] }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await callAs(student, `/staging-batches/${batch.id}`, { method: "DELETE" })).status,
    ).toBe(409);

    await jsonAs(student, `/staging-batches/${batch.id}/send-back`, post({ to: "producer" }));
    expect(await s.statuses(ids[0])).toBe("todo waiting waiting");
    expect((await stage()).status).toBe(200);
    expect((await s.batch(batch.id)).instances).toHaveLength(3);
  });

  it("is deleted while it's there, which frees its parts and keeps its file", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 1);
    const file = await s.upload();
    const { batch } = await s.newBatch({ fileId: file.id, partInstanceIds: ids });
    await s.move(batch.id, "producer", "doing");
    expect(
      (await callAs(student, `/staging-batches/${batch.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(await s.batch(batch.id)).toBeUndefined();
    expect(await s.statuses(ids[0])).toBe("todo waiting waiting");
    expect((await jsonAs<StoredFile[]>(student, "/part-files")).map((f) => f.id)).toContain(
      file.id,
    );
  });
});

describe("a batch at its File Consumer process", () => {
  it("starts and completes as one, and its parts move on", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 2);
    const { batch } = await s.newBatch({ partInstanceIds: ids });
    expect((await s.move(batch.id, "consumer", "doing")).status).toBe(409);
    await s.move(batch.id, "producer", "done");

    expect((await s.move(batch.id, "consumer", "doing")).status).toBe(200);
    expect(await s.statuses(ids[1])).toBe("done doing waiting");
    expect((await s.move(batch.id, "consumer", "doing")).status).toBe(409);
    expect((await s.move(batch.id, "consumer", "done")).status).toBe(200);
    expect(await s.statuses(ids[0])).toBe("done done todo");
    const done = await s.batch(batch.id);
    expect(done).toMatchObject({ consumerStatus: "done" });
    expect(done.completedAt).toBeGreaterThan(0);

    // Back to To Do there, with everything after it.
    await jsonAs(student, `/staging-batches/${batch.id}/send-back`, post({ to: "consumer" }));
    expect(await s.statuses(ids[0])).toBe("done todo waiting");
    expect(await s.batch(batch.id)).toMatchObject({ consumerStatus: "todo", completedAt: null });
  });

  it("sends one part back to be made again, and keeps a record of it", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 2);
    const { batch } = await s.newBatch({ partInstanceIds: ids });
    const sendBack = (instanceId: number) =>
      callAs(student, `/staging-batches/${batch.id}/instances/${instanceId}/send-back`, post());
    // While it's being prepared a part is just taken out.
    expect((await sendBack(ids[0])).status).toBe(409);

    await s.move(batch.id, "producer", "done");
    await s.move(batch.id, "consumer", "doing");
    expect((await sendBack(ids[0])).status).toBe(200);
    expect(await s.statuses(ids[0])).toBe("todo waiting waiting");
    expect((await sendBack(ids[0])).status).toBe(404);

    const after = await s.batch(batch.id);
    expect(after.label).toBe("Plate × 1");
    expect(after.instances).toEqual([
      expect.objectContaining({ partInstanceId: ids[1], removedAt: null }),
      expect.objectContaining({ partInstanceId: ids[0], removedBy: student.id }),
    ]);
    expect(after.instances[1].removedAt).toBeGreaterThan(0);

    // The one that worked moves on; the one sent back is free for another batch.
    expect((await s.move(batch.id, "consumer", "done")).status).toBe(200);
    expect(await s.statuses(ids[1])).toBe("done done todo");
    const again = await s.newBatch({ partInstanceIds: [ids[0]] });
    expect(again.batch.instances).toHaveLength(1);
  });
});

describe("copying a batch", () => {
  it("needs as many free parts as the batch was made with", async () => {
    const s = await shop();
    const plates = await s.part("Plate", 3);
    const file = await s.upload();
    const { batch } = await s.newBatch({
      fileId: file.id,
      partInstanceIds: plates.ids.slice(0, 2),
    });
    await s.move(batch.id, "producer", "done");

    const plan = await jsonAs<DuplicatePlan>(student, `/staging-batches/${batch.id}/duplicate`);
    expect(plan).toMatchObject({ ok: false, reason: null });
    expect(plan.parts).toEqual([
      expect.objectContaining({ name: "Plate", needed: 2, available: 1 }),
    ]);
    const refused = await callAs(student, `/staging-batches/${batch.id}/duplicate`, post());
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { plan: DuplicatePlan }).plan.parts[0].available).toBe(1);

    // One sent back is still one the file makes, and is free again.
    await callAs(
      student,
      `/staging-batches/${batch.id}/instances/${plates.ids[0]}/send-back`,
      post(),
    );
    const copy = await jsonAs<{ batch: Batch }>(
      student,
      `/staging-batches/${batch.id}/duplicate`,
      post(),
      201,
    );
    expect(copy.batch).toMatchObject({
      label: "Plate × 2",
      producerStatus: "todo",
      file: { id: file.id },
    });
    expect(copy.batch.instances.map((i) => i.partInstanceId).sort()).toEqual(
      [plates.ids[0], plates.ids[2]].sort(),
    );
    expect(copy.batch.number).toBeGreaterThan(batch.number);
  });
});

describe("obsolete files", () => {
  it("makes a file obsolete with any instance it was made for, for good", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 3);
    const file = await s.upload();
    const { batch } = await s.newBatch({ fileId: file.id, partInstanceIds: ids.slice(0, 2) });
    const isObsolete = async () =>
      (await jsonAs<StoredFile[]>(student, "/part-files")).find((f) => f.id === file.id)?.obsolete;
    expect(await isObsolete()).toBe(false);

    await jsonAs(student, `/part-instances/${ids[0]}`, {
      method: "PATCH",
      body: { isStale: true },
    });
    expect(await isObsolete()).toBe(true);
    expect((await s.batch(batch.id)).file?.obsolete).toBe(true);

    // It can't go on another batch, and its batch can't be copied.
    const other = (await s.newBatch()).batch;
    const put = await callAs(student, `/staging-batches/${other.id}/file`, {
      method: "PUT",
      body: { fileId: file.id },
    });
    expect(put.status).toBe(409);
    expect(await error(put)).toMatch(/now obsolete/);
    expect(
      (
        await callAs(
          student,
          "/staging-batches",
          post({ processId: s.cam.id, fileId: file.id, partInstanceIds: [ids[2]] }),
        )
      ).status,
    ).toBe(409);
    const plan = await jsonAs<DuplicatePlan>(student, `/staging-batches/${batch.id}/duplicate`);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/now obsolete/);

    // Deleting the obsolete instance doesn't bring the file back.
    expect((await callAs(admin, "/admin/obsolete-instances", { method: "DELETE" })).status).toBe(
      200,
    );
    expect((await s.batch(batch.id)).instances.map((i) => i.partInstanceId)).toEqual([ids[1]]);
    expect(await isObsolete()).toBe(true);
  });

  it("leaves a batch without a file when its file is deleted", async () => {
    const s = await shop();
    const { ids } = await s.part("Plate", 1);
    const file = await s.upload();
    const { batch } = await s.newBatch({ fileId: file.id, partInstanceIds: ids });
    expect((await callAs(student, `/part-files/${file.id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect(await s.batch(batch.id)).toMatchObject({ fileId: null, file: null });
  });
});

describe("the order of file processes", () => {
  const step = (name: string, type: string) => ({ name, type });
  const cam = step("CAM", "file_producer");
  const router = step("Router", "file_consumer");
  const deburr = step("Deburr", "regular");

  it("wants the process that uses a file after the one that makes it", () => {
    expect(fileStepError([deburr])).toBeNull();
    expect(fileStepError([cam, deburr, router])).toBeNull();
    expect(fileStepError([cam, router, cam, router])).toBeNull();
    expect(fileStepError([cam])).toMatch(/also needs a File Consumer/);
    expect(fileStepError([router, cam])).toMatch(/Router uses a file, so it has to come after/);
    expect(fileStepError([cam, router, cam])).toMatch(/CAM makes a file, so a File Consumer/);
  });

  it("is checked when a part is made", async () => {
    const s = await shop();
    const subsystem = await jsonAs<Id>(student, "/subsystems", post({ name: "Order" }), 201);
    const res = await callAs(
      student,
      "/part-definitions",
      post({
        onshapePartNumber: `ORD-${crypto.randomUUID().slice(0, 8)}`,
        revision: "A",
        subsystemId: subsystem.id,
        name: "Backwards",
        processIds: [s.router.id, s.cam.id],
      }),
    );
    expect(res.status).toBe(400);
    expect(await error(res)).toMatch(/has to come after the File Producer process/);
  });
});
