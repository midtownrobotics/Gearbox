// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { type StorageReport, withTeam } from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { createDb } from "../src/db";
import { autoRoutines } from "../src/db/schema";

it("labels owned auton images and exports only that team's real files", async () => {
  const bindings = env as unknown as { SCOUTING_DB: D1Database; FIELD_MAPS: R2Bucket };
  const team = newTeamId();
  const other = newTeamId();
  const key = `teams/${team}/auto/test.png`;
  await createDb(bindings.SCOUTING_DB)
    .insert(autoRoutines)
    .values(
      withTeam(team, {
        id: crypto.randomUUID(),
        name: "Left start",
        steps_json: "[]",
        tags_json: "[]",
        created_by: "admin",
        created_at: Date.now(),
        updated_at: Date.now(),
        image_r2_key: key,
      }),
    );
  await bindings.FIELD_MAPS.put(key, "path-image");
  await bindings.FIELD_MAPS.put(`teams/${other}/private.png`, "private-image");
  const path = `/api/internal/teams/${team}/storage`;
  const report = await (await call(path)).json<StorageReport>();
  expect(report.allowances[0].files).toHaveLength(1);
  expect(report.allowances[0].files[0].name).toContain("Auton: Left start");
  expect(JSON.stringify(report)).not.toContain(other);
  const download = await call(`${path}/download?key=${encodeURIComponent(key)}`);
  expect(new TextDecoder().decode(await download.arrayBuffer())).toBe("path-image");
  expect(
    (await call(`${path}/download?key=${encodeURIComponent(`teams/${other}/private.png`)}`)).status,
  ).toBe(404);
});
