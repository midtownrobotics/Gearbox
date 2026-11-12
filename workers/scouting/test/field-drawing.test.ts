// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import type { StorageReport } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import {
  FIELD_DRAWING_TYPE,
  type FieldDrawing,
  MAX_DRAWING_POINTS,
  MAX_DRAWING_STROKES,
  MAX_FIELD_DRAWING_BYTES,
  createFieldDrawing,
  drawingDraftFile,
  fieldDrawingFile,
  parseFieldDrawing,
  trajectoryFieldDrawing,
} from "../src/field-drawing";
import { fieldDrawingSvg } from "../src/field-drawing-svg";

const bindings = env as unknown as { FIELD_MAPS: R2Bucket };
const sample = (): FieldDrawing => ({
  version: 1,
  field: "2026-rebuilt",
  strokes: [
    {
      tool: "draw",
      color: "#ff334f",
      points: [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.8, 0.2],
      ],
    },
    {
      tool: "arrow",
      color: "#35d06f",
      points: [
        [0.4, 0.2],
        [0.5, 0.6],
      ],
    },
    {
      tool: "sotm",
      color: "#ffd43b",
      points: [
        [0.2, 0.6],
        [0.3, 0.6],
        [0.4, 0.7],
      ],
    },
  ],
});

describe("bounded field geometry", () => {
  it("keeps off-canvas trajectory coordinates instead of bending a clipped route", async () => {
    const file = fieldDrawingFile(
      trajectoryFieldDrawing(
        {
          format: "Choreo",
          name: "Route",
          points: [
            { x: -1, y: 0 },
            { x: 2, y: 1 },
          ],
        },
        "#123456",
      ),
    );
    const drawing = parseFieldDrawing(JSON.parse(await file.text()));
    expect(drawing.strokes[0].tool).toBe("trajectory");
    expect(drawing.strokes[0].color).toBe("#123456");
    expect(drawing.strokes[0].points[0][0]).toBeLessThan(0);
    expect(drawing.strokes[0].points[0][1]).toBeCloseTo((8.0692 + 0.5) / 9.0692, 4);
    expect(fieldDrawingSvg(drawing, "<svg/>")).toContain('overflow="hidden"');
  });

  it("keeps closed loops and the chosen shooting hub through simplification", () => {
    const drawing = createFieldDrawing([
      {
        tool: "sotm",
        color: "#ff334f",
        hub: "right",
        points: [
          [0.1, 0.2],
          [0.3, 0.4],
          [0.2, 0.6],
          [0.1, 0.2],
        ],
      },
    ]);
    expect(drawing.strokes[0].points).toHaveLength(4);
    expect(drawing.strokes[0].hub).toBe("right");
    expect(fieldDrawingSvg(drawing, "<svg/>")).toContain("990.92");
  });
  it("compacts straight samples while preserving corners, colors and field identity", () => {
    const drawing = createFieldDrawing([
      {
        tool: "route",
        color: "#FF334F",
        points: Array.from({ length: 1000 }, (_, i) => [i / 1000, 0.5]),
      },
    ]);
    expect(drawing.field).toBe("2026-rebuilt");
    expect(drawing.strokes[0]).toMatchObject({
      color: "#ff334f",
      points: [
        [0, 0.5],
        [0.999, 0.5],
      ],
    });
    expect(JSON.stringify(drawing).length).toBeLessThan(200);
    const corner = createFieldDrawing([
      {
        tool: "route",
        color: "#ff334f",
        points: [
          [0, 0],
          [0.5, 0],
          [0.5, 0.5],
        ],
      },
    ]);
    expect(corner.strokes[0].points).toHaveLength(3);
  });

  it("rejects unsupported fields, markup, invalid coordinates, and unbounded geometry", () => {
    for (const drawing of [
      { ...sample(), field: "https://outside.test/field.svg" },
      { ...sample(), version: 2 },
      { ...sample(), strokes: [{ ...sample().strokes[0], color: 'red"/><script/>' }] },
      {
        ...sample(),
        strokes: [
          {
            ...sample().strokes[0],
            points: [
              [Number.NaN, 0],
              [1, 1],
            ],
          },
        ],
      },
      {
        ...sample(),
        strokes: [
          {
            ...sample().strokes[0],
            points: [
              [-100, 0],
              [1, 1],
            ],
          },
        ],
      },
      {
        ...sample(),
        strokes: [
          {
            ...sample().strokes[0],
            points: [
              [0, 0],
              [1, 100],
            ],
          },
        ],
      },
      {
        ...sample(),
        strokes: Array.from({ length: MAX_DRAWING_STROKES + 1 }, () => sample().strokes[0]),
      },
      {
        ...sample(),
        strokes: [
          {
            ...sample().strokes[0],
            points: Array.from({ length: MAX_DRAWING_POINTS + 1 }, () => [0.1, 0.2]),
          },
        ],
      },
    ])
      expect(() => parseFieldDrawing(drawing)).toThrow();
  });

  it("restores vector drafts as coordinates and keeps legacy image drafts byte-for-byte", async () => {
    const vector = await drawingDraftFile(JSON.stringify(sample()), "auto");
    expect(vector.type).toBe(FIELD_DRAWING_TYPE);
    expect(JSON.parse(await vector.text())).toEqual(sample());
    const image = await drawingDraftFile("data:image/png;base64,b2xkLWRyYXdpbmc=", "auto");
    expect(image.type).toBe("image/png");
    expect(await image.text()).toBe("old-drawing");
    await expect(drawingDraftFile("https://outside.test/image.png", "auto")).rejects.toThrow();
  });

  it("renders gradients, arrows, cones, and escaped labels over a single shared field", () => {
    const svg = fieldDrawingSvg(
      { ...sample(), label: '<script>alert("x")</script>' },
      '<svg viewBox="0 0 1 1"><rect id="generic-field" /></svg>',
    );
    expect(svg).toContain("linearGradient");
    expect(svg).toContain('opacity=".22"');
    expect(svg.match(/id="generic-field"/g)).toHaveLength(1);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });
});

describe("saved vector drawings", () => {
  it("stores only JSON for new auton routes, renders an image, and isolates teams", async () => {
    const teamId = newTeamId();
    const team = teamUsers(teamId);
    const other = teamUsers(newTeamId());
    const body = new FormData();
    body.set("name", "Left start");
    body.set("image", fieldDrawingFile(sample()));
    const { id } = await jsonAs<{ id: string }>(
      team.student,
      "/scouting/autos",
      { method: "POST", body },
      201,
    );
    const objects = await bindings.FIELD_MAPS.list({ prefix: `teams/${teamId}/auto-images/` });
    expect(objects.objects).toHaveLength(1);
    expect(objects.objects[0].key).toMatch(/\.json$/);
    expect(objects.objects[0].size).toBeLessThan(1000);
    const object = await bindings.FIELD_MAPS.get(objects.objects[0].key);
    expect(await object?.json()).toEqual(sample());
    const image = await callAs(team.student, `/scouting/autos/${id}/image`);
    expect(image.headers.get("Content-Type")).toBe("image/svg+xml");
    const svg = new TextDecoder().decode(await image.arrayBuffer());
    expect(svg).toContain('id="field"');
    expect(svg).toContain("stroke-0-0");
    expect(svg).not.toContain("data:image/png");
    expect((await callAs(other.student, `/scouting/autos/${id}/image`)).status).toBe(404);
    const exported = await call(
      `/api/internal/teams/${teamId}/storage/download?key=${encodeURIComponent(objects.objects[0].key)}`,
    );
    expect(exported.headers.get("Content-Disposition")).toContain(".svg");
    expect(exported.headers.get("Content-Type")).toBe("image/svg+xml");
    const archive = await call(`/api/internal/teams/${teamId}/storage/archive`);
    const backup = new TextDecoder().decode(await archive.arrayBuffer());
    expect(backup).toContain("2026-rebuilt");
    expect(backup).toContain("field-2026.svg");
    const report = await (
      await call(`/api/internal/teams/${teamId}/storage`)
    ).json<StorageReport>();
    expect(report.allowances[0].bytes).toBe(objects.objects[0].size);
  });

  it("accepts coordinate files on report fields and leaves old PNGs untouched", async () => {
    const team = teamUsers(newTeamId());
    const { id } = await jsonAs<{ id: string }>(
      team.admin,
      "/scouting/scouting-forms",
      {
        method: "POST",
        body: {
          name: "Pit paths",
          kind: "pit",
          fields: [{ id: "path", type: "fieldMap", label: "Auto path", required: true }],
        },
      },
      201,
    );
    for (const file of [
      fieldDrawingFile(sample()),
      new File(["old-png"], "old.png", { type: "image/png" }),
    ]) {
      const form = new FormData();
      form.set("teamName", "123");
      form.set("answers", "{}");
      form.set("drawing:path", file);
      const response = await callAs(team.student, `/scouting/scouting-forms/${id}/submissions`, {
        method: "POST",
        body: form,
      });
      expect(response.status).toBe(201);
    }
    const reports = await jsonAs<{ submissions: { id: string }[] }>(
      team.admin,
      `/scouting/scouting-forms/${id}/submissions`,
    );
    expect(reports.submissions).toHaveLength(2);
    const views = await Promise.all(
      reports.submissions.map((r) =>
        callAs(team.student, `/scouting/scouting-submissions/${r.id}/drawings/path`),
      ),
    );
    expect(views.map((r) => r.headers.get("Content-Type")).sort()).toEqual([
      "image/png",
      "image/svg+xml",
    ]);
    expect(await views.find((r) => r.headers.get("Content-Type") === "image/png")?.text()).toBe(
      "old-png",
    );
  });

  it("rejects malformed or excessive JSON without saving any file", async () => {
    const teamId = newTeamId();
    const team = teamUsers(teamId);
    for (const text of [
      "not-json",
      JSON.stringify({ ...sample(), field: "bad-field" }),
      " ".repeat(MAX_FIELD_DRAWING_BYTES + 1),
    ]) {
      const body = new FormData();
      body.set("name", "Bad drawing");
      body.set("image", new File([text], "path.json", { type: FIELD_DRAWING_TYPE }));
      expect((await callAs(team.student, "/scouting/autos", { method: "POST", body })).status).toBe(
        400,
      );
    }
    expect((await bindings.FIELD_MAPS.list({ prefix: `teams/${teamId}/` })).objects).toHaveLength(
      0,
    );
  });

  it("shares built-in field maps as coordinates, while allowing empty reusable backgrounds", async () => {
    const teamId = newTeamId();
    const team = teamUsers(teamId);
    for (const drawing of [sample(), createFieldDrawing([])]) {
      const form = new FormData();
      form.set("name", "Shared plan");
      form.set("image", fieldDrawingFile(drawing));
      const { id } = await jsonAs<{ id: string }>(
        team.admin,
        "/scouting/field-maps",
        { method: "POST", body: form },
        201,
      );
      const image = await callAs(team.student, `/scouting/field-maps/${id}/image`);
      expect(image.headers.get("Content-Type")).toBe("image/svg+xml");
      const text = new TextDecoder().decode(await image.arrayBuffer());
      expect(text).toContain('id="field"');
    }
    const objects = await bindings.FIELD_MAPS.list({ prefix: `teams/${teamId}/field-maps/` });
    expect(objects.objects).toHaveLength(2);
    expect(objects.objects.every((object) => object.key.endsWith(".json"))).toBe(true);
  });
});
