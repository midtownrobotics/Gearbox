import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import {
  formatThickness,
  matchPart,
  parseMeasurement,
  plateThickness,
} from "../src/lib/part-recognition";

// Part recognition on Ingest: an admin switches it on, and each pending part's material and
// thickness come from the team's Onshape. Onshape itself isn't reached in tests: these cover the
// rules for reading its answers, the switch, and a part's kept answer.

const database = (env as unknown as { SHOP_DB: D1Database }).SHOP_DB;
const INCH = 0.0254;

/** A pending part of the team's, as a release leaves it, with what recognition kept (if anything). */
async function pendingPart(teamId: string, recognition?: unknown) {
  const partNumber = `PN-${crypto.randomUUID().slice(0, 8)}`;
  const row = await database
    .prepare(
      "INSERT INTO onshape_parts (team_id, onshape_release_id, part_number, entity_id, version_id, recognition, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(
      teamId,
      `rel-${partNumber}`,
      partNumber,
      "element",
      "version",
      recognition === undefined ? null : JSON.stringify(recognition),
      Math.floor(Date.now() / 1000),
    )
    .first<{ id: number }>();
  return row?.id as number;
}

describe("reading Onshape's answers", () => {
  it("finds the released part by number, then name, then as the only one", () => {
    const parts = [
      { partId: "JHD", name: "Side Plate", partNumber: "G3-101" },
      { partId: "JKD", name: "Spacer", partNumber: null },
      { partId: "JLD", name: "Sketch body", bodyType: "wire" },
    ];
    expect(matchPart(parts, "g3-101", null)?.partId).toBe("JHD");
    expect(matchPart(parts, "G3-999", "spacer")?.partId).toBe("JKD");
    expect(matchPart(parts, "G3-999", "Other")).toBeNull();
    expect(matchPart([parts[1], parts[2]], "G3-999", null)?.partId).toBe("JKD");
  });

  it("reads the measurement, and refuses anything else", () => {
    const number = (value: number) => ({ btType: "BTFSValueNumber", value });
    expect(
      parseMeasurement({ result: { value: [0.3, 0.1, 0.00635, 0.03, 0.00019].map(number) } }),
    ).toEqual({ box: [0.3, 0.1, 0.00635], faceArea: 0.03, volume: 0.00019 });
    expect(parseMeasurement({ result: { value: [number(1)] } })).toBeNull();
    expect(parseMeasurement({ result: { value: "nope" } })).toBeNull();
    expect(parseMeasurement(null)).toBeNull();
  });

  it("gives a plate its thickness, and nothing else one", () => {
    const t = 0.25 * INCH;
    // A 12" × 6" plate with a few holes.
    const plate = { box: [12 * INCH, 6 * INCH, t] as [number, number, number] };
    const face = 12 * INCH * 6 * INCH * 0.9;
    expect(plateThickness({ ...plate, faceArea: face, volume: face * t * 0.98 })).toBe(t);
    // A 2" × 1" tube, 48" long: its side is its largest face, but it's mostly hollow.
    const tube = { box: [48 * INCH, 2 * INCH, 1 * INCH] as [number, number, number] };
    expect(
      plateThickness({ ...tube, faceArea: 96 * INCH * INCH, volume: 33 * INCH ** 3 }),
    ).toBeNull();
    // A block: its height isn't small next to its sides.
    const block = { box: [2 * INCH, 2 * INCH, 1.5 * INCH] as [number, number, number] };
    expect(
      plateThickness({ ...block, faceArea: 4 * INCH * INCH, volume: 6 * INCH ** 3 }),
    ).toBeNull();
  });

  it("writes thicknesses as the shop does", () => {
    expect(formatThickness(0.25 * INCH)).toBe('0.25"');
    expect(formatThickness(0.125 * INCH)).toBe('0.125"');
    expect(formatThickness((3 / 64) * INCH)).toBe('0.0469"');
    expect(formatThickness(0.003)).toBe("3 mm");
    expect(formatThickness(0.0015)).toBe("1.5 mm");
    expect(formatThickness(0.1234 * INCH)).toBe('0.123"');
  });
});

describe("part recognition", () => {
  it("is off until an admin switches it on, and /me says so", async () => {
    const team = teamUsers(newTeamId());
    const id = await pendingPart(team.teamId);
    expect(await jsonAs(team.student, "/me")).toMatchObject({ partRecognition: false });
    expect(
      (await callAs(team.student, `/admin/onshape/recognize/${id}`, { method: "POST" })).status,
    ).toBe(403);

    // Only an admin switches it, and never from a kiosk.
    for (const who of [team.student, team.mentor, team.kioskAdmin]) {
      const res = await callAs(who, "/admin/onshape/recognition", {
        method: "POST",
        body: { enabled: true },
      });
      expect(res.status).toBe(403);
    }
    expect(
      (
        await callAs(team.admin, "/admin/onshape/recognition", {
          method: "POST",
          body: { enabled: "yes" },
        })
      ).status,
    ).toBe(400);
    await jsonAs(team.admin, "/admin/onshape/recognition", {
      method: "POST",
      body: { enabled: true },
    });
    expect(await jsonAs(team.student, "/me")).toMatchObject({ partRecognition: true });
    expect(await jsonAs(team.admin, "/admin/onshape/config")).toMatchObject({
      partRecognition: true,
    });
    expect(await jsonAs(team.admin, "/team-settings")).toMatchObject({
      values: { partRecognition: true },
    });
  });

  it("answers what it kept for a part, without asking Onshape again", async () => {
    const team = teamUsers(newTeamId());
    await jsonAs(team.admin, "/admin/onshape/recognition", {
      method: "POST",
      body: { enabled: true },
    });
    const kept = {
      material: "Aluminum - 6061",
      thickness: '0.25"',
      size: [0.3, 0.15, 0.00635],
      at: 1,
    };
    const id = await pendingPart(team.teamId, kept);
    expect(
      await jsonAs(team.student, `/admin/onshape/recognize/${id}`, { method: "POST" }),
    ).toEqual(kept);
  });

  it("needs the team's Onshape keys, and only reads the team's own parts", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    for (const team of [a, b]) {
      await jsonAs(team.admin, "/admin/onshape/recognition", {
        method: "POST",
        body: { enabled: true },
      });
    }
    const mine = await pendingPart(a.teamId);
    const theirs = await pendingPart(b.teamId, {
      material: "B's secret",
      thickness: null,
      size: null,
      at: 1,
    });

    const noKeys = await callAs(a.student, `/admin/onshape/recognize/${mine}`, { method: "POST" });
    expect(noKeys.status).toBe(400);
    const other = await callAs(a.student, `/admin/onshape/recognize/${theirs}`, { method: "POST" });
    expect(other.status).toBe(404);
    expect(await other.text()).not.toContain("B's secret");
  });
});
