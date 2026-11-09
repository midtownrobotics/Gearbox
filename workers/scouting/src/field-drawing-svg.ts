// SPDX-License-Identifier: AGPL-3.0-only
import type { DrawingPoint, FieldDrawing } from "./field-drawing";

const WIDTH = 1400;
const HEIGHT = (WIDTH * 9.0692) / 17.541;
const point = (p: DrawingPoint) => `${p[0] * WIDTH},${p[1] * HEIGHT}`;
const path = (points: DrawingPoint[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${point(p)}`).join(" ");
function drawingColorAt(hex: string, progress: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const base = (value >> shift) & 255;
    return progress < 0.5
      ? Math.round(base + (255 - base) * (0.32 * (1 - progress * 2)))
      : Math.round(base * (1 - 0.42 * ((progress - 0.5) * 2)));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}
const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );

/** Same canonical field and brush geometry, used for saved views and restoring vector drafts. */
export function fieldDrawingSvg(drawing: FieldDrawing, fieldSvg: string): string {
  const result: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" overflow="hidden"><rect width="100%" height="100%" fill="#17191d"/>`,
    fieldSvg.replace("<svg ", `<svg width="${WIDTH}" height="${HEIGHT}" `),
  ];
  drawing.strokes.forEach((stroke, index) => {
    let d = path(stroke.points);
    if (stroke.tool === "arrow") {
      const [from, to] = stroke.points;
      const x = to[0] * WIDTH;
      const y = to[1] * HEIGHT;
      const angle = Math.atan2(y - from[1] * HEIGHT, x - from[0] * WIDTH);
      d += ` L${x - 22 * Math.cos(angle - Math.PI / 6)},${y - 22 * Math.sin(angle - Math.PI / 6)} M${x},${y} L${x - 22 * Math.cos(angle + Math.PI / 6)},${y - 22 * Math.sin(angle + Math.PI / 6)}`;
    }
    result.push(
      stroke.tool === "trajectory"
        ? `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="rgba(255,255,255,.9)" stroke-width="10"/>`
        : `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="rgba(0,0,0,.9)" stroke-width="${stroke.tool === "arrow" ? 25 : 29}"/><path d="${d}" stroke="rgba(255,255,255,.98)" stroke-width="${stroke.tool === "arrow" ? 18 : 21}"/>`,
    );
    if (stroke.tool === "draw" || stroke.tool === "sotm") {
      const lengths = stroke.points
        .slice(1)
        .map((p, i) =>
          Math.hypot((p[0] - stroke.points[i][0]) * WIDTH, (p[1] - stroke.points[i][1]) * HEIGHT),
        );
      const total = lengths.reduce((n, length) => n + length, 0) || 1;
      let traveled = 0;
      lengths.forEach((length, i) => {
        const from = stroke.points[i];
        const to = stroke.points[i + 1];
        const start = traveled / total;
        traveled += length;
        const id = `stroke-${index}-${i}`;
        result.push(
          `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${from[0] * WIDTH}" y1="${from[1] * HEIGHT}" x2="${to[0] * WIDTH}" y2="${to[1] * HEIGHT}"><stop stop-color="${drawingColorAt(stroke.color, start)}"/><stop offset="1" stop-color="${drawingColorAt(stroke.color, traveled / total)}"/></linearGradient></defs><path d="${path([from, to])}" stroke="url(#${id})" stroke-width="12"/>`,
        );
      });
    } else
      result.push(
        `<path d="${d}" stroke="${stroke.color}" stroke-width="${stroke.tool === "arrow" ? 10 : stroke.tool === "trajectory" ? 6 : 12}"/>`,
      );
    result.push("</g>");
    if (stroke.tool === "sotm") {
      const middle = stroke.points[Math.floor(stroke.points.length / 2)];
      result.push(
        `<path d="${d} L${WIDTH * (stroke.hub === "left" || (!stroke.hub && middle[0] < 0.5) ? 0.2922 : 0.7078)},${HEIGHT * 0.5} Z" fill="${stroke.color}" opacity=".22"/>`,
      );
    }
    if (stroke.tool === "trajectory") {
      result.push(
        `<circle cx="${stroke.points[0][0] * WIDTH}" cy="${stroke.points[0][1] * HEIGHT}" r="11" fill="#2e7d32"/><circle cx="${stroke.points[stroke.points.length - 1][0] * WIDTH}" cy="${stroke.points[stroke.points.length - 1][1] * HEIGHT}" r="11" fill="${stroke.color}"/>`,
      );
    }
  });
  if (drawing.label)
    result.push(
      `<text x="28" y="42" fill="#202124" font-family="system-ui" font-size="26" font-weight="600">${escapeXml(drawing.label)}</text>`,
    );
  result.push("</svg>");
  return result.join("");
}
