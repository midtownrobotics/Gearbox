// SPDX-License-Identifier: AGPL-3.0-only
import { fieldDrawingFile, trajectoryFieldDrawing } from "@g3/worker-scouting/field-drawing";

export type TrajectoryPoint = { x: number; y: number };
export type ParsedTrajectory = {
  format: "Choreo" | "PathPlanner";
  name: string;
  points: TrajectoryPoint[];
};

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (value && typeof value === "object" && "val" in value) {
    const val = (value as { val?: unknown }).val;
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  }
  return null;
}

function pointFrom(value: unknown): TrajectoryPoint | null {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    numberValue(value[1]) !== null &&
    numberValue(value[2]) !== null
  ) {
    const x = numberValue(value[1]);
    const y = numberValue(value[2]);
    if (x !== null && y !== null) {
      return { x, y };
    }
  }
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const preferred = [item.anchor, item.position, item.translation, item.pose, item];
  for (const candidate of preferred) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Record<string, unknown>;
    const x = numberValue(source.x);
    const y = numberValue(source.y);
    if (x !== null && y !== null) return { x, y };
    const nested = pointFrom(source.translation);
    if (nested) return nested;
  }
  return null;
}

function pointsFrom(value: unknown): TrajectoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => (Array.isArray(item) ? pointsFrom(item) : [pointFrom(item)]))
    .filter((point): point is TrajectoryPoint => point !== null);
}

function findPointArrays(value: unknown, found: TrajectoryPoint[][] = []) {
  if (Array.isArray(value)) {
    const points = pointsFrom(value);
    if (points.length > 1) found.push(points);
    for (const item of value) findPointArrays(item, found);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      findPointArrays(child, found);
    }
  }
  return found;
}

export async function parseTrajectoryFile(file: File): Promise<ParsedTrajectory> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("This trajectory file does not contain a JSON object.");
  }
  const data = parsed as Record<string, unknown>;
  const trajectory = data.trajectory as Record<string, unknown> | undefined;
  const snapshot = data.snapshot as Record<string, unknown> | undefined;
  const params = data.params as Record<string, unknown> | undefined;
  const choreo =
    pointsFrom(trajectory?.samples).length > 1
      ? pointsFrom(trajectory?.samples)
      : pointsFrom(snapshot?.waypoints).length > 1
        ? pointsFrom(snapshot?.waypoints)
        : pointsFrom(params?.waypoints);
  const pathPlanner = pointsFrom(data.waypoints);
  const discovered = findPointArrays(data).sort((a, b) => b.length - a.length)[0] ?? [];
  const points = choreo.length > 1 ? choreo : pathPlanner.length > 1 ? pathPlanner : discovered;
  if (points.length < 2) {
    const keys = Object.keys(data).slice(0, 6).join(", ");
    throw new Error(`No coordinates found in this .traj file${keys ? ` (found: ${keys})` : ""}.`);
  }
  return {
    format: choreo.length > 1 ? "Choreo" : "PathPlanner",
    name:
      (typeof data.name === "string" && data.name) || file.name.replace(/\.(traj|path|json)$/i, ""),
    points,
  };
}

export function trajectoryToDrawing(trajectory: ParsedTrajectory, color?: string): File {
  const brand =
    color ?? getComputedStyle(document.documentElement).getPropertyValue("--g3-brand").trim();
  if (!/^#[0-9a-f]{6}$/i.test(brand))
    throw new Error("The team color hasn't loaded. Try again in a moment.");
  return fieldDrawingFile(trajectoryFieldDrawing(trajectory, brand), `${trajectory.name}.json`);
}
