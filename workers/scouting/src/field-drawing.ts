// SPDX-License-Identifier: AGPL-3.0-only
export const FIELD_DRAWING_TYPE = "application/vnd.gearbox.field-drawing+json";
export const MAX_FIELD_DRAWING_BYTES = 96 * 1024;
export const MAX_DRAWING_POINTS = 4096;
export const MAX_DRAWING_STROKES = 128;
export const FIELD_IMAGE = "/field-2026.svg";
/** Relative to the field viewport; a bounded off-canvas margin preserves clipped strokes. */
export type DrawingPoint = [number, number];
export type FieldStroke = {
  tool: "draw" | "arrow" | "sotm" | "route" | "trajectory";
  color: string;
  points: DrawingPoint[];
  hub?: "left" | "right";
};
export type FieldDrawing = {
  version: 1;
  field: "2026-rebuilt";
  strokes: FieldStroke[];
  label?: string;
};

/** Only geometry and a pinned built-in field; never client-provided SVG, markup, or URLs. */
export function parseFieldDrawing(value: unknown): FieldDrawing {
  if (!value || typeof value !== "object") throw new Error("Invalid field drawing.");
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    data.field !== "2026-rebuilt" ||
    !Array.isArray(data.strokes) ||
    data.strokes.length > MAX_DRAWING_STROKES
  )
    throw new Error("Unsupported field drawing.");
  let total = 0;
  const strokes = data.strokes.map((raw: unknown): FieldStroke => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid drawing stroke.");
    const stroke = raw as Record<string, unknown>;
    if (
      typeof stroke.tool !== "string" ||
      !["draw", "arrow", "sotm", "route", "trajectory"].includes(stroke.tool) ||
      typeof stroke.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(stroke.color) ||
      !Array.isArray(stroke.points) ||
      stroke.points.length < 2
    )
      throw new Error("Invalid drawing stroke.");
    total += stroke.points.length;
    if (total > MAX_DRAWING_POINTS || (stroke.tool === "arrow" && stroke.points.length !== 2))
      throw new Error("This drawing has too many points.");
    const points = stroke.points.map((point: unknown): DrawingPoint => {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < -16 || n > 17)
      )
        throw new Error("Invalid drawing coordinates.");
      return [Math.round(point[0] * 10000) / 10000, Math.round(point[1] * 10000) / 10000];
    });
    if (!points.some((point) => point[0] !== points[0][0] || point[1] !== points[0][1]))
      throw new Error("Draw a path with some movement.");
    if (
      stroke.hub !== undefined &&
      (stroke.tool !== "sotm" ||
        typeof stroke.hub !== "string" ||
        !["left", "right"].includes(stroke.hub))
    )
      throw new Error("Invalid shooting hub.");
    return {
      tool: stroke.tool as FieldStroke["tool"],
      color: stroke.color.toLowerCase(),
      points,
      ...(stroke.hub ? { hub: stroke.hub as "left" | "right" } : {}),
    };
  });
  if (data.label !== undefined && (typeof data.label !== "string" || data.label.length > 160))
    throw new Error("Invalid drawing label.");
  return {
    version: 1,
    field: "2026-rebuilt",
    strokes,
    ...(typeof data.label === "string" ? { label: data.label } : {}),
  };
}

/** Remove redundant samples within about half a canvas pixel, preserving corners and endpoints. */
export function compactDrawingPoints(points: DrawingPoint[], tolerance = 0.00035): DrawingPoint[] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop() as [number, number];
    const [x, y] = points[start];
    const [endX, endY] = points[end];
    const dx = endX - x;
    const dy = endY - y;
    const length = dx * dx + dy * dy;
    let max = tolerance * tolerance;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const t = length
        ? Math.max(0, Math.min(1, ((points[i][0] - x) * dx + (points[i][1] - y) * dy) / length))
        : 0;
      const distance = (points[i][0] - x - t * dx) ** 2 + (points[i][1] - y - t * dy) ** 2;
      if (distance > max) {
        max = distance;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      pending.push([start, index], [index, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

export function createFieldDrawing(strokes: FieldStroke[], label?: string): FieldDrawing {
  if (strokes.reduce((n, stroke) => n + stroke.points.length, 0) > 65536)
    throw new Error("This path has too many samples. Use a shorter route.");
  const compact = strokes.map((stroke) => ({
    ...stroke,
    ...(stroke.tool === "sotm"
      ? {
          hub:
            stroke.hub ??
            (stroke.points[Math.floor(stroke.points.length / 2)]?.[0] < 0.5
              ? ("left" as const)
              : ("right" as const)),
        }
      : {}),
    points: compactDrawingPoints(stroke.points),
  }));
  return parseFieldDrawing({
    version: 1,
    field: "2026-rebuilt",
    strokes: compact,
    ...(label ? { label } : {}),
  });
}

export function fieldDrawingFile(drawing: FieldDrawing, name = "field-path.json") {
  const json = JSON.stringify(parseFieldDrawing(drawing));
  if (new TextEncoder().encode(json).length > MAX_FIELD_DRAWING_BYTES)
    throw new Error("This drawing is too complex. Undo a stroke and try again.");
  return new File([json], name, { type: FIELD_DRAWING_TYPE });
}

/** Choreo/PathPlanner coordinates are meters from the field's lower-left corner. */
export function trajectoryFieldDrawing(
  trajectory: { format: string; name: string; points: { x: number; y: number }[] },
  color: string,
): FieldDrawing {
  const points = trajectory.points.map(
    (point): DrawingPoint => [(point.x + 0.5) / 17.541, (8.0692 - point.y + 0.5) / 9.0692],
  );
  return createFieldDrawing(
    [{ tool: "trajectory", color, points }],
    `${trajectory.format} · ${trajectory.name}`.slice(0, 160),
  );
}

export async function drawingDraftFile(saved: string, name: string): Promise<File> {
  if (saved.startsWith("{"))
    return fieldDrawingFile(parseFieldDrawing(JSON.parse(saved)), `${name}.json`);
  // Preserve pre-upgrade drafts as images; never try to infer coordinates from their pixels.
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(saved))
    throw new Error("The saved drawing could not be read.");
  const response = await fetch(saved);
  const blob = await response.blob();
  return new File([blob], `${name}.${blob.type === "image/png" ? "png" : "jpg"}`, {
    type: blob.type,
  });
}
