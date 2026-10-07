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

const FIELD_WIDTH = 8.0692;
const FIELD_VIEWBOX = { x: -0.5, y: -0.5, width: 17.541, height: 9.0692 };

export async function trajectoryToPng(trajectory: ParsedTrajectory): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = Math.round((canvas.width * FIELD_VIEWBOX.height) / FIELD_VIEWBOX.width);
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Canvas is unavailable."));
  const px = (x: number) => ((x - FIELD_VIEWBOX.x) / FIELD_VIEWBOX.width) * canvas.width;
  const py = (y: number) =>
    ((FIELD_WIDTH - y - FIELD_VIEWBOX.y) / FIELD_VIEWBOX.height) * canvas.height;

  const field = new Image();
  field.src = "/field-2026.svg";
  await new Promise<void>((resolve, reject) => {
    field.onload = () => resolve();
    field.onerror = () => reject(new Error("Could not load the 2026 field background."));
  });
  // The path and its end are drawn in the team's brand colour (colors.css).
  const brand =
    getComputedStyle(document.documentElement).getPropertyValue("--g3-brand").trim() || "#a71433";
  context.fillStyle = "#17191d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(field, 0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 10;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  trajectory.points.forEach((point, index) =>
    index ? context.lineTo(px(point.x), py(point.y)) : context.moveTo(px(point.x), py(point.y)),
  );
  context.stroke();
  context.strokeStyle = brand;
  context.lineWidth = 6;
  context.beginPath();
  trajectory.points.forEach((point, index) =>
    index ? context.lineTo(px(point.x), py(point.y)) : context.moveTo(px(point.x), py(point.y)),
  );
  context.stroke();
  context.fillStyle = "#2e7d32";
  context.beginPath();
  context.arc(px(trajectory.points[0].x), py(trajectory.points[0].y), 11, 0, Math.PI * 2);
  context.fill();
  const end = trajectory.points.at(-1);
  if (end) {
    context.fillStyle = brand;
    context.beginPath();
    context.arc(px(end.x), py(end.y), 11, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#202124";
  context.font = "600 26px system-ui";
  context.fillText(`${trajectory.format} · ${trajectory.name}`, 28, 42);
  return new Promise<File>((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Could not render trajectory."));
      resolve(new File([blob], `${trajectory.name}-plot.png`, { type: "image/png" }));
    }, "image/png"),
  );
}
