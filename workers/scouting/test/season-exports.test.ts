// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { inTeam, withTeam } from "@g3/auth";
import {
  type SeasonExport,
  type SeasonPlan,
  type SeasonResetResult,
  digestHex,
  verifySeasonBackup,
} from "@g3/auth/season-export";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import {
  autoRoutines,
  manualEvents,
  robotImages,
  robotTeams,
  scoutingFormSubmissions,
  scoutingForms,
  seasonExportParts,
  seasonExports,
  strategyEventConfig,
} from "../src/db/schema";
import { expireSeasonExports } from "../src/season-exports";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
const db = createDb(bindings.SCOUTING_DB);
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing expected backup value.");
  return value;
}
const base = (team: string) => `/api/internal/teams/${team}/seasons`;
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
async function read<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return JSON.parse(text) as T;
}
async function seed(team = newTeamId()) {
  await db.insert(scoutingForms).values(
    withTeam(team, {
      id: "form",
      name: "Reusable form",
      fields_json: "[]",
      created_by: "admin",
      created_at: 1,
      updated_at: 1,
    }),
  );
  const key = `teams/${team}/scouting-submissions/report.png`;
  await bindings.FIELD_MAPS.put(key, "valuable drawing", {
    httpMetadata: { contentType: "image/png" },
  });
  await db.insert(scoutingFormSubmissions).values(
    withTeam(team, [
      {
        id: "report",
        form_id: "form",
        answers_json: '{"score":42}',
        submitted_by: "scout",
        submitted_by_name: "Scout",
        created_at: Date.now(),
        event_key: "2024test",
        drawing_r2_key: key,
        drawing_content_type: "image/png",
      },
      {
        id: "other-year",
        form_id: "form",
        answers_json: '{"keep":true}',
        submitted_by: "scout",
        submitted_by_name: "Scout",
        created_at: 1,
        event_key: "2025test",
      },
      {
        id: "unknown",
        form_id: "form",
        answers_json: '{"unknown":true}',
        submitted_by: "scout",
        submitted_by_name: "Scout",
        created_at: Date.UTC(2024, 1, 1),
      },
    ]),
  );
  await db.insert(autoRoutines).values(
    withTeam(team, {
      id: "auto",
      name: "Auton to review",
      steps_json: '["score"]',
      tags_json: "[]",
      created_by: "admin",
      created_at: 1,
      updated_at: 1,
    }),
  );
  return { team, key };
}
async function prepare(team: string, includeUnknown = false) {
  const plan = await read<SeasonPlan>(await call(`${base(team)}?year=2024`));
  const selection = plan.items
    .filter((item) => item.year === 2024 || includeUnknown)
    .map((item) => item.key);
  return read<SeasonExport>(
    await call(`${base(team)}/exports`, json({ year: 2024, selection })),
    201,
  );
}
async function archive(team: string, job: SeasonExport, index = 0) {
  const response = await call(`${base(team)}/exports/${job.id}/${index}/archive`, {
    method: "POST",
  });
  expect(response.status).toBe(200);
  const bytes = await response.arrayBuffer();
  const next = await read<SeasonExport>(await call(`${base(team)}/exports/${job.id}`));
  return { bytes, job: next, hash: required(next.parts[index].archiveHash) };
}
const reset = (team: string, job: SeasonExport, hash: string) =>
  call(
    `${base(team)}/exports/${job.id}/0/reset`,
    json({ archiveHash: hash, confirmation: "RESET 2024" }),
  );
function unpack(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (let offset = 0; offset < bytes.length && bytes[offset]; ) {
    const name = decoder.decode(bytes.subarray(offset, offset + 100)).replace(/\0.*$/, "");
    const length = Number.parseInt(decoder.decode(bytes.subarray(offset + 124, offset + 136)), 8);
    files.set(name, decoder.decode(bytes.subarray(offset + 512, offset + 512 + length)));
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  return files;
}

describe("season export and reset", () => {
  it("refuses an oversized review before loading full answers and preserves the team's data", async () => {
    const { team, key } = await seed();
    const answers = JSON.stringify({ note: "x".repeat(1024 ** 2) });
    for (let index = 0; index < 9; index++)
      await db.insert(scoutingFormSubmissions).values(
        withTeam(team, {
          id: `large-${index}`,
          form_id: "form",
          answers_json: answers,
          submitted_by: "scout",
          submitted_by_name: "Scout",
          created_at: 1,
          event_key: "2024test",
        }),
      );
    const response = await call(`${base(team)}?year=2024`);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("too much data");
    expect(await db.select().from(seasonExports).where(inTeam(seasonExports, team))).toHaveLength(
      0,
    );
    expect(await bindings.FIELD_MAPS.head(key)).not.toBeNull();
  });

  it("full team deletion also clears temporary receipts without changing another team's export", async () => {
    const a = await seed();
    const b = await seed();
    await prepare(a.team);
    const jobB = await prepare(b.team);
    expect((await call(`/api/internal/teams/${a.team}`, { method: "DELETE" })).status).toBe(200);
    expect(await db.select().from(seasonExports).where(inTeam(seasonExports, a.team))).toHaveLength(
      0,
    );
    expect(
      await db.select().from(seasonExportParts).where(inTeam(seasonExportParts, a.team)),
    ).toHaveLength(0);
    expect((await call(`${base(b.team)}/exports/${jobB.id}`)).status).toBe(200);
    expect(await bindings.FIELD_MAPS.head(b.key)).not.toBeNull();
  });
  it("uses the game event's year, never the upload year, and requires selection of unlinked items", async () => {
    const { team } = await seed();
    await db.insert(manualEvents).values(
      withTeam(team, {
        event_key: "manual-event",
        event_name: "Practice",
        ends_at: Date.UTC(2024, 5, 1),
        delete_after: Date.now() + 99999999,
        created_by: "admin",
        updated_at: 1,
      }),
    );
    const plan = await read<SeasonPlan>(await call(`${base(team)}?year=2024`));
    expect(plan.items.filter((item) => item.year === 2024).map((item) => item.label)).toEqual(
      expect.arrayContaining(["2024test"]),
    );
    expect(plan.items.find((item) => item.label === "Practice")?.year).toBeNull();
    expect(plan.items.some((item) => item.label === "2025test")).toBe(false);
    expect(plan.items.filter((item) => item.year === null).map((item) => item.kind)).toContain(
      "Auton routines",
    );
    expect(plan.items.find((item) => item.key.includes("unknown"))?.year).toBeNull();
    expect((await call(`${base(team)}?year=abc`)).status).toBe(400);
    expect(
      (
        await call(
          `${base(team)}/exports`,
          json({ year: 2024, selection: ["scouting_form_submissions:event:2025test"] }),
        )
      ).status,
    ).toBe(409);
  });

  it("exports actual files and records, hashes the complete tar, and verifies the saved archive", async () => {
    const { team } = await seed();
    const prepared = await prepare(team);
    expect(prepared.parts[0].archiveHash).toBeNull();
    const { bytes, job, hash } = await archive(team, prepared);
    expect(hash).toBe(digestHex(await crypto.subtle.digest("SHA-256", bytes)));
    const files = unpack(bytes);
    expect([...files.values()]).toContain("valuable drawing");
    expect(files.has("field-2026.svg")).toBe(true);
    const data = JSON.parse(required(files.get("data.json")));
    expect(data).toMatchObject({ format: "gearbox-season-export", teamId: team, year: 2024 });
    expect(data.rows).toHaveLength(1);
    expect(data.formTemplates[0].name).toBe("Reusable form");
    expect(
      await verifySeasonBackup(new Blob([bytes]), hash, required(job.parts[0].archiveSize)),
    ).toBe(true);
    expect(
      await verifySeasonBackup(
        new Blob([bytes.slice(0, -1)]),
        hash,
        required(job.parts[0].archiveSize),
      ),
    ).toBe(false);
    const damaged = bytes.slice(0);
    new Uint8Array(damaged)[600] ^= 1;
    expect(
      await verifySeasonBackup(new Blob([damaged]), hash, required(job.parts[0].archiveSize)),
    ).toBe(false);
    expect(
      await db.select().from(scoutingFormSubmissions).where(inTeam(scoutingFormSubmissions, team)),
    ).toHaveLength(3);
  });

  it("rejects reset without a completed backup and exact confirmation", async () => {
    const { team } = await seed();
    const job = await prepare(team);
    expect((await reset(team, job, "made-up")).status).toBe(400);
    const exported = await archive(team, job);
    expect(
      (
        await call(
          `${base(team)}/exports/${job.id}/0/reset`,
          json({ archiveHash: exported.hash, confirmation: "RESET 2025" }),
        )
      ).status,
    ).toBe(400);
    expect((await call(`${base(team)}/exports/${job.id}/0/reset`)).status).toBe(404);
  });

  it("resets only backed-up selected data, preserves settings, other years and another team, and is idempotent", async () => {
    const a = await seed();
    const b = await seed();
    await db.insert(strategyEventConfig).values(
      withTeam(a.team, {
        id: 1,
        event_key: "2024test",
        current_match_number: 8,
        updated_by: "admin",
        updated_at: 1,
        tba_auth_key: "private-tba",
        nexus_api_key: "private-nexus",
        submission_window_seconds: 60,
      }),
    );
    const exported = await archive(a.team, await prepare(a.team));
    expect(new TextDecoder().decode(exported.bytes)).not.toContain("private-tba");
    const result = await read<SeasonResetResult>(await reset(a.team, exported.job, exported.hash));
    expect(result).toEqual({ removed: 2, kept: 0, filesRemoved: 1 });
    expect(await bindings.FIELD_MAPS.head(a.key)).toBeNull();
    expect(await bindings.FIELD_MAPS.head(b.key)).not.toBeNull();
    expect(
      (
        await db
          .select()
          .from(scoutingFormSubmissions)
          .where(inTeam(scoutingFormSubmissions, a.team))
      )
        .map((row) => row.id)
        .sort(),
    ).toEqual(["other-year", "unknown"]);
    expect(await db.select().from(scoutingForms).where(inTeam(scoutingForms, a.team))).toHaveLength(
      1,
    );
    expect(await db.select().from(autoRoutines).where(inTeam(autoRoutines, a.team))).toHaveLength(
      1,
    );
    expect(
      await db.select().from(strategyEventConfig).where(inTeam(strategyEventConfig, a.team)).get(),
    ).toMatchObject({
      event_key: "",
      current_match_number: null,
      tba_auth_key: "private-tba",
      nexus_api_key: "private-nexus",
      submission_window_seconds: 60,
    });
    expect(await read(await reset(a.team, exported.job, exported.hash))).toEqual(result);
    expect(
      await db
        .select()
        .from(scoutingFormSubmissions)
        .where(inTeam(scoutingFormSubmissions, b.team)),
    ).toHaveLength(3);
  });

  it("keeps records edited after export and new reports from the same season", async () => {
    const { team, key } = await seed();
    const exported = await archive(team, await prepare(team));
    await db
      .update(scoutingFormSubmissions)
      .set({ answers_json: '{"new":"valuable"}' })
      .where(inTeam(scoutingFormSubmissions, team, eq(scoutingFormSubmissions.id, "report")));
    await db.insert(scoutingFormSubmissions).values(
      withTeam(team, {
        id: "new",
        form_id: "form",
        answers_json: "{}",
        submitted_by: "scout",
        submitted_by_name: "Scout",
        created_at: 1,
        event_key: "2024test",
      }),
    );
    expect(await read(await reset(team, exported.job, exported.hash))).toEqual({
      removed: 0,
      kept: 1,
      filesRemoved: 0,
    });
    expect(await bindings.FIELD_MAPS.head(key)).not.toBeNull();
    expect(
      await db.select().from(scoutingFormSubmissions).where(inTeam(scoutingFormSubmissions, team)),
    ).toHaveLength(4);
  });

  it("never cascades into a robot photo added after its profile was exported", async () => {
    const { team } = await seed();
    await db.insert(robotTeams).values(
      withTeam(team, {
        id: "robot",
        team_name: "Practice robot",
        created_by: "admin",
        created_at: 1,
        updated_at: 1,
      }),
    );
    const exported = await archive(team, await prepare(team, true));
    const key = `teams/${team}/robot-photos/new.png`;
    await bindings.FIELD_MAPS.put(key, "new photo");
    await db.insert(robotImages).values(
      withTeam(team, {
        id: "new-photo",
        robot_id: "robot",
        r2_key: key,
        content_type: "image/png",
        created_by: "admin",
        created_at: 1,
      }),
    );
    const result = await read<SeasonResetResult>(await reset(team, exported.job, exported.hash));
    expect(result.kept).toBe(1);
    expect(await db.select().from(robotTeams).where(inTeam(robotTeams, team))).toHaveLength(1);
    expect(await bindings.FIELD_MAPS.head(key)).not.toBeNull();
  });

  it("keeps a changed file version and a file still referenced by another year's record", async () => {
    const a = await seed();
    const exportedA = await archive(a.team, await prepare(a.team));
    await bindings.FIELD_MAPS.put(a.key, "changed image");
    expect(
      (await read<SeasonResetResult>(await reset(a.team, exportedA.job, exportedA.hash))).kept,
    ).toBe(1);
    expect(await bindings.FIELD_MAPS.get(a.key).then((file) => file?.text())).toBe("changed image");
    const b = await seed();
    await db
      .update(scoutingFormSubmissions)
      .set({ drawing_r2_key: b.key })
      .where(inTeam(scoutingFormSubmissions, b.team, eq(scoutingFormSubmissions.id, "other-year")));
    const exportedB = await archive(b.team, await prepare(b.team));
    expect(
      (await read<SeasonResetResult>(await reset(b.team, exportedB.job, exportedB.hash)))
        .filesRemoved,
    ).toBe(0);
    expect(await bindings.FIELD_MAPS.head(b.key)).not.toBeNull();
  });

  it("cannot use another team's export id and enforces one temporary export per team", async () => {
    const a = await seed();
    const b = await seed();
    const job = await prepare(a.team);
    expect((await call(`${base(b.team)}/exports/${job.id}`)).status).toBe(404);
    expect(
      (await call(`${base(b.team)}/exports/${job.id}/0/archive`, { method: "POST" })).status,
    ).toBe(404);
    expect((await reset(b.team, job, "bad")).status).toBe(404);
    expect((await call(`${base(b.team)}/exports/${job.id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect((await call(`${base(a.team)}/exports/${job.id}`)).status).toBe(200);
    const plan = await read<SeasonPlan>(await call(`${base(a.team)}?year=2024`));
    expect(
      (
        await call(
          `${base(a.team)}/exports`,
          json({
            year: 2024,
            selection: plan.items.filter((item) => item.year === 2024).map((item) => item.key),
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("expires or discards receipts without deleting game data or files", async () => {
    const { team, key } = await seed();
    const job = await prepare(team);
    await db.update(seasonExports).set({ expiresAt: 1 }).where(inTeam(seasonExports, team));
    expect((await call(`${base(team)}/exports/${job.id}`)).status).toBe(404);
    await expireSeasonExports(bindings);
    expect(
      await db.select().from(seasonExportParts).where(inTeam(seasonExportParts, team)),
    ).toHaveLength(0);
    expect(
      await db.select().from(scoutingFormSubmissions).where(inTeam(scoutingFormSubmissions, team)),
    ).toHaveLength(3);
    expect(await bindings.FIELD_MAPS.head(key)).not.toBeNull();
    const next = await prepare(team);
    expect((await call(`${base(team)}/exports/${next.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await bindings.FIELD_MAPS.head(key)).not.toBeNull();
  });

  it("requires every archive part in order and leaves newly added reports out of the reset", async () => {
    const { team } = await seed();
    for (let index = 0; index < 100; index++)
      await db.insert(scoutingFormSubmissions).values(
        withTeam(team, {
          id: `extra-${index}`,
          form_id: "form",
          answers_json: "{}",
          submitted_by: "scout",
          submitted_by_name: "Scout",
          created_at: 1,
          event_key: "2024test",
        }),
      );
    const job = await prepare(team);
    expect(job.parts).toHaveLength(2);
    const first = await archive(team, job, 0);
    const second = await archive(team, job, 1);
    const secondReset = () =>
      call(
        `${base(team)}/exports/${job.id}/1/reset`,
        json({ archiveHash: second.hash, confirmation: "RESET 2024" }),
      );
    expect((await secondReset()).status).toBe(409);
    expect((await reset(team, job, first.hash)).status).toBe(200);
    expect((await secondReset()).status).toBe(200);
    expect(
      (await db.select().from(scoutingFormSubmissions).where(inTeam(scoutingFormSubmissions, team)))
        .map((row) => row.id)
        .sort(),
    ).toEqual(["other-year", "unknown"]);
  });

  it("does not issue a receipt when a file changes during the export", async () => {
    const { team, key } = await seed();
    const job = await prepare(team);
    await bindings.FIELD_MAPS.put(key, "different contents");
    const response = await call(`${base(team)}/exports/${job.id}/0/archive`, { method: "POST" });
    await expect(response.arrayBuffer()).rejects.toThrow();
    const saved = await read<SeasonExport>(await call(`${base(team)}/exports/${job.id}`));
    expect(saved.parts[0].archiveHash).toBeNull();
    expect((await reset(team, job, "fake")).status).toBe(400);
    expect(
      await db.select().from(scoutingFormSubmissions).where(inTeam(scoutingFormSubmissions, team)),
    ).toHaveLength(3);
  });
});
