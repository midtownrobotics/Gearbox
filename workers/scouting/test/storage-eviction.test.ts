// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { inTeam, withStorageLimit, withTeam } from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import {
  autoRoutines,
  robotImages,
  robotTeams,
  scoutingFormSubmissions,
  scoutingForms,
} from "../src/db/schema";
import { scoutingStorageEviction } from "../src/storage-limit";
import type { AppEnv } from "../src/types";

const bindings = env as unknown as AppEnv["Bindings"];
const db = createDb(bindings.SCOUTING_DB);

describe("Scouting image cleanup", () => {
  it("blocks new image growth and keeps existing files when the team disables automatic deletion", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    await bindings.G3ID.fetch(`http://g3id/api/internal/teams/${team}/storage-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ automaticDeletion: false }),
    });
    const key = `${prefix}existing.png`;
    await bindings.FIELD_MAPS.put(key, "x".repeat(100));
    await expect(
      withStorageLimit(
        bindings.SCOUTING_DB,
        bindings.FIELD_MAPS,
        team,
        prefix,
        [{ key: `${prefix}new.png`, bytes: 10 }],
        { bytes: 100, objects: 10, label: "test" },
        () => bindings.FIELD_MAPS.put(`${prefix}new.png`, "x".repeat(10)),
        scoutingStorageEviction(bindings, team),
      ),
    ).rejects.toMatchObject({ code: "storage_full" });
    expect((await bindings.FIELD_MAPS.head(key))?.size).toBe(100);
    expect(await bindings.FIELD_MAPS.head(`${prefix}new.png`)).toBeNull();
  });
  it("removes an evicted recent robot photo from the gallery while keeping the robot profile", async () => {
    const team = newTeamId();
    const prefix = `teams/${team}/`;
    const key = `${prefix}robot-images/photo.png`;
    await bindings.FIELD_MAPS.put(key, "x".repeat(100));
    await db.insert(robotTeams).values(
      withTeam(team, {
        id: "robot",
        team_name: "Practice robot",
        summary: "Keep this profile",
        created_by: "admin",
        created_at: 1,
        updated_at: 1,
      }),
    );
    await db.insert(robotImages).values(
      withTeam(team, {
        id: "photo",
        robot_id: "robot",
        r2_key: key,
        content_type: "image/png",
        created_by: "admin",
        created_at: 1,
      }),
    );
    const incoming = `${prefix}new.png`;
    await withStorageLimit(
      bindings.SCOUTING_DB,
      bindings.FIELD_MAPS,
      team,
      prefix,
      [{ key: incoming, bytes: 10 }],
      { bytes: 100, objects: 10, label: "100 bytes" },
      () => bindings.FIELD_MAPS.put(incoming, "x".repeat(10)),
      scoutingStorageEviction(bindings, team),
    );
    expect(await bindings.FIELD_MAPS.head(key)).toBeNull();
    expect(await bindings.FIELD_MAPS.head(incoming)).not.toBeNull();
    expect(await db.select().from(robotImages).where(inTeam(robotImages, team))).toHaveLength(0);
    expect(await db.select().from(robotTeams).where(inTeam(robotTeams, team)).get()).toMatchObject({
      summary: "Keep this profile",
    });
  });
  it.each(["png", "json"])(
    "removes old %s drawings while keeping auton steps and written reports",
    async (extension) => {
      const team = newTeamId();
      const prefix = `teams/${team}/`;
      const auto = `${prefix}auto-images/auto-old.${extension}`;
      const drawing =
        extension === "json"
          ? `${prefix}scouting-submissions/submission-old.json`
          : `${prefix}scouting-submissions/submission-old/map.png`;
      await bindings.FIELD_MAPS.put(auto, "x".repeat(40));
      await bindings.FIELD_MAPS.put(drawing, "x".repeat(40));
      await db.insert(autoRoutines).values(
        withTeam(team, {
          id: "auto-old",
          name: "Keep this routine",
          steps_json: '["score"]',
          tags_json: "[]",
          created_by: "test",
          created_at: 1,
          updated_at: 1,
          image_r2_key: auto,
          image_content_type: "image/png",
        }),
      );
      await db.insert(scoutingForms).values(
        withTeam(team, {
          id: "form-old",
          name: "Form",
          description: "",
          fields_json: "[]",
          is_active: 1,
          created_by: "test",
          created_at: 1,
          updated_at: 1,
        }),
      );
      await db.insert(scoutingFormSubmissions).values(
        withTeam(team, {
          id: "submission-old",
          form_id: "form-old",
          drawing_r2_key: extension === "json" ? drawing : null,
          drawing_content_type:
            extension === "json" ? "application/vnd.gearbox.field-drawing+json" : null,
          answers_json: '{"note":"keep this report"}',
          submitted_by: "test",
          submitted_by_name: "Test",
          created_at: 1,
          drawing_fields_json: JSON.stringify({ map: { key: drawing, contentType: "image/png" } }),
        }),
      );
      const key = `${prefix}auto-images/new.png`;
      await withStorageLimit(
        bindings.SCOUTING_DB,
        bindings.FIELD_MAPS,
        team,
        prefix,
        [{ key, bytes: 100 }],
        { bytes: 100, objects: 10, label: "100 bytes" },
        () => bindings.FIELD_MAPS.put(key, "x".repeat(100)),
        {
          ...scoutingStorageEviction(bindings, team),
          approvedObjects: new Map(
            (await bindings.FIELD_MAPS.list({ prefix })).objects.map((file) => [
              file.key,
              file.etag,
            ]),
          ),
        },
      );
      const routine = await db
        .select()
        .from(autoRoutines)
        .where(eq(autoRoutines.teamId, team))
        .get();
      expect(routine?.steps_json).toBe('["score"]');
      expect(routine?.image_r2_key).toBeNull();
      const report = await db
        .select()
        .from(scoutingFormSubmissions)
        .where(eq(scoutingFormSubmissions.teamId, team))
        .get();
      expect(report?.answers_json).toBe('{"note":"keep this report"}');
      expect(report?.drawing_fields_json).toBe("{}");
      expect(report?.drawing_r2_key).toBeNull();
      expect(await bindings.FIELD_MAPS.head(auto)).toBeNull();
      expect(await bindings.FIELD_MAPS.head(drawing)).toBeNull();
      expect((await bindings.FIELD_MAPS.head(key))?.size).toBe(100);
    },
  );
});
