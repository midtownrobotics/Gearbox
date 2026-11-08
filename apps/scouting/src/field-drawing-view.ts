// SPDX-License-Identifier: AGPL-3.0-only
import {
  FIELD_DRAWING_TYPE,
  FIELD_IMAGE,
  parseFieldDrawing,
} from "@g3/worker-scouting/field-drawing";
import { fieldDrawingSvg } from "@g3/worker-scouting/field-drawing-svg";

let field: Promise<string> | undefined;
export function sharedFieldSvg() {
  field ??= fetch(FIELD_IMAGE)
    .then((response) => {
      if (!response.ok) throw new Error("The field image could not be loaded.");
      return response.text();
    })
    .catch((error) => {
      field = undefined;
      throw error;
    });
  return field;
}

/** Local previews are rendered on demand; the saved Blob stays compact JSON. */
export async function fieldDrawingImage(blob: Blob): Promise<Blob> {
  if (blob.type !== FIELD_DRAWING_TYPE) return blob;
  const drawing = parseFieldDrawing(JSON.parse(await blob.text()));
  return new Blob([fieldDrawingSvg(drawing, await sharedFieldSvg())], { type: "image/svg+xml" });
}
