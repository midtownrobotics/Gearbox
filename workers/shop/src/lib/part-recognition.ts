import type { createShopDb } from "../db";
import { type OnshapeCredentials, basicAuth } from "./onshape-config";
import { SETTING, getSetting } from "./settings";

// Part recognition (an Admin setting, used on Ingest): what Onshape knows about a released part
// that Ingest would otherwise ask for by hand. Its material is the part's Onshape material; its
// size is the part's box lined up with its largest flat face, so a plate's thickness is the box's
// height whichever way the plate sits in its Part Studio. Thickness is only given for a plate: a
// part whose volume is about its largest face times that height (a tube or a bracket isn't).

/** Whether the team has part recognition on (Shop's Admin page, Onshape Configuration). */
export async function partRecognitionOn(db: ReturnType<typeof createShopDb>, teamId: string) {
  return (await getSetting(db, teamId, SETTING.partRecognition)) === "1";
}

/** What recognition found, as kept on the release's part (`onshape_parts.recognition`). */
export type Recognition = {
  /** The part's material in Onshape ("Aluminum - 6061"), or null when it has none. */
  material: string | null;
  /** Shop's free-text thickness ('0.25"', "3 mm"), only for a plate. */
  thickness: string | null;
  /** The part's size in meters, largest first, or null when Onshape couldn't measure it. */
  size: [number, number, number] | null;
  /** When it was recognized (ms). */
  at: number;
};

/** One part in a Part Studio, from GET /parts. */
type OnshapePart = {
  partId?: string;
  name?: string;
  partNumber?: string | null;
  bodyType?: string;
  material?: { displayName?: string; id?: string } | null;
};

/** The Part Studio's part that is the released one: by part number, else by name, else the only one. */
export function matchPart(
  parts: OnshapePart[],
  partNumber: string,
  name: string | null,
): OnshapePart | null {
  const solid = parts.filter((p) => p.partId && (!p.bodyType || p.bodyType === "solid"));
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    solid.find((p) => same(p.partNumber, partNumber)) ??
    (name ? solid.find((p) => same(p.name, name)) : undefined) ??
    (solid.length === 1 ? solid[0] : null) ??
    null
  );
}

/**
 * Measures one part: [x, y, z] of its box in the coordinate system of its largest flat face (z
 * along the face's normal; the part's own box when it has no flat face), the face's area and the
 * part's volume, all in SI units as plain numbers.
 */
export const MEASURE_SCRIPT = `function(context is Context, queries is map)
{
    var part = queries.id;
    var best = undefined;
    var bestArea = 0 * meter ^ 2;
    for (var face in evaluateQuery(context, qGeometry(qOwnedByBody(part, EntityType.FACE), GeometryType.PLANE)))
    {
        var area = evArea(context, { "entities" : face });
        if (area > bestArea)
        {
            bestArea = area;
            best = face;
        }
    }
    var options = { "topology" : part, "tight" : true };
    if (best != undefined)
        options.cSys = planeToCSys(evPlane(context, { "face" : best }));
    var box = evBox3d(context, options);
    var size = box.maxCorner - box.minCorner;
    var volume = evVolume(context, { "entities" : part });
    return [abs(size[0]) / meter, abs(size[1]) / meter, abs(size[2]) / meter, bestArea / meter ^ 2, volume / meter ^ 3];
}`;

export type Measurement = { box: [number, number, number]; faceArea: number; volume: number };

/** The numbers MEASURE_SCRIPT returns, from Onshape's FeatureScript answer; null if it isn't that. */
export function parseMeasurement(answer: unknown): Measurement | null {
  const result = (answer as { result?: { value?: unknown } } | null)?.result;
  const values = Array.isArray(result?.value) ? result.value : null;
  if (!values || values.length < 5) return null;
  const numbers = values.map((v) => (v as { value?: unknown })?.value);
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  const [x, y, z, faceArea, volume] = numbers as number[];
  if (x <= 0 || y <= 0 || z <= 0) return null;
  return { box: [x, y, z], faceArea, volume };
}

/**
 * The plate's thickness in meters, or null when the part isn't a plate: its box's height (along
 * the largest face's normal) is its smallest side, at most half the next, and its volume is about
 * the face times that height. Countersinks and chamfers take a little off; a partly pocketed face
 * leaves a little more.
 */
export function plateThickness({ box, faceArea, volume }: Measurement): number | null {
  const [x, y, z] = box;
  if (faceArea <= 0 || z > Math.min(x, y) / 2) return null;
  const fill = volume / (faceArea * z);
  return fill >= 0.8 && fill <= 1.25 ? z : null;
}

const INCH = 0.0254;

/**
 * A thickness as the shop writes it: inches when it's a 64th of an inch ('0.25"', '0.125"'), else
 * millimeters when it's a half millimeter ("3 mm", "1.5 mm"), else inches to a thousandth.
 */
export function formatThickness(meters: number): string {
  const inches = meters / INCH;
  const sixtyFourths = Math.round(inches * 64);
  if (sixtyFourths > 0 && Math.abs(inches - sixtyFourths / 64) < 0.0005) {
    return `${trim(sixtyFourths / 64, 4)}"`;
  }
  const mm = meters * 1000;
  const halves = Math.round(mm * 2);
  if (halves > 0 && Math.abs(mm - halves / 2) < 0.01) return `${trim(halves / 2, 1)} mm`;
  return `${trim(inches, 3)}"`;
}

const trim = (n: number, places: number) => String(Number(n.toFixed(places)));

/** Where a release's part is in Onshape. */
export type PartLocation = {
  documentId: string;
  versionId: string;
  /** The Part Studio. */
  elementId: string;
  partNumber: string;
  name: string | null;
};

export class RecognitionError extends Error {}

async function onshape(credentials: OnshapeCredentials, path: string, init?: RequestInit) {
  const response = await fetch(`https://cad.onshape.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: basicAuth(credentials),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    console.error("[Part Recognition]", path, response.status, response.statusText);
    throw new RecognitionError(
      response.status === 401 || response.status === 403
        ? "Onshape refused the team's API keys."
        : response.status === 429
          ? "The team's Onshape API allowance is used up for now."
          : `Onshape answered ${response.status}.`,
    );
  }
  return response.json();
}

/** Recognizes one released part: two calls to Onshape (its Part Studio's parts, then a measurement). */
export async function recognizePart(
  credentials: OnshapeCredentials,
  location: PartLocation,
): Promise<Recognition> {
  const { documentId, versionId, elementId } = location;
  const studio = `/d/${encodeURIComponent(documentId)}/v/${encodeURIComponent(versionId)}/e/${encodeURIComponent(elementId)}`;
  const parts = (await onshape(credentials, `/parts${studio}?withThumbnails=false`)) as unknown;
  const part = matchPart(Array.isArray(parts) ? parts : [], location.partNumber, location.name);
  if (!part?.partId) {
    throw new RecognitionError("This part wasn't found in its Part Studio.");
  }
  const material = part.material?.displayName?.trim() || null;

  let measurement: Measurement | null = null;
  try {
    measurement = parseMeasurement(
      await onshape(credentials, `/partstudios${studio}/featurescript`, {
        method: "POST",
        body: JSON.stringify({
          script: MEASURE_SCRIPT,
          queries: [{ key: "id", value: [part.partId] }],
        }),
      }),
    );
  } catch (err) {
    // The material is still worth having when the part can't be measured.
    console.error("[Part Recognition] Measuring failed", location.partNumber, err);
  }

  const thickness = measurement ? plateThickness(measurement) : null;
  const size = measurement
    ? ([...measurement.box].sort((a, b) => b - a) as [number, number, number])
    : null;
  return {
    material,
    thickness: thickness === null ? null : formatThickness(thickness),
    size,
    at: Date.now(),
  };
}
