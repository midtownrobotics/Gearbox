// SPDX-License-Identifier: AGPL-3.0-only
import fieldSvg from "../../../apps/scouting/public/field-2026.svg";
import {
  FIELD_DRAWING_TYPE,
  MAX_FIELD_DRAWING_BYTES,
  fieldDrawingFile,
  parseFieldDrawing,
} from "./field-drawing";
import { fieldDrawingSvg } from "./field-drawing-svg";

export const drawingArchiveAssets = [
  { name: "field-2026.svg", bytes: new TextEncoder().encode(fieldSvg) },
];

export async function downloadableDrawing(object: R2ObjectBody): Promise<Response | undefined> {
  if (object.httpMetadata?.contentType !== FIELD_DRAWING_TYPE) return undefined;
  const response = await drawingResponse(object, FIELD_DRAWING_TYPE);
  response.headers.set("Cache-Control", "private, no-store");
  if (response.ok) {
    const filename =
      object.key
        .split("/")
        .pop()
        ?.replace(/\.json$/, ".svg") ?? "field-path.svg";
    response.headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
  }
  return response;
}

export async function validateDrawingUpload(file: File, allowEmpty = false): Promise<File> {
  if (file.type === FIELD_DRAWING_TYPE) {
    if (file.size > MAX_FIELD_DRAWING_BYTES)
      throw new Error("Field paths must be 96 KiB or smaller.");
    const drawing = parseFieldDrawing(JSON.parse(await file.text()));
    if (!allowEmpty && !drawing.strokes.length) throw new Error("Draw a path before submitting.");
    return fieldDrawingFile(drawing);
  }
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 ** 2)
    throw new Error("Drawings must be field paths or images under 12 MB.");
  return file;
}

export async function drawingResponse(object: R2ObjectBody, contentType: string) {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
  if (contentType !== FIELD_DRAWING_TYPE) return new Response(object.body, { headers });
  try {
    if (object.size > MAX_FIELD_DRAWING_BYTES) throw new Error("Invalid field drawing.");
    const drawing = parseFieldDrawing(await object.json());
    return new Response(fieldDrawingSvg(drawing, fieldSvg), {
      headers: {
        ...headers,
        "Content-Type": "image/svg+xml",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return Response.json({ error: "The saved field path could not be read." }, { status: 422 });
  }
}
