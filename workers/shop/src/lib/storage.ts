// Where a team's files are in R2: everything under teams/<team>/, so one team's keys can never
// name another's object. Drawings are found by part number and revision; part files keep their key
// in `files.r2_key`.

export const teamPrefix = (teamId: string) => `teams/${teamId}/`;

/** The team's released drawings (as `drawingKey` writes them). */
export const drawingsPrefix = (teamId: string) => `${teamPrefix(teamId)}drawings/`;

/** A part revision's drawing PDF (barcode-stamped on the way in). */
export const drawingKey = (teamId: string, partNumber: string, revision: string) =>
  `${drawingsPrefix(teamId)}${partNumber}/${revision}/drawing.pdf`;

/** A drawing uploaded by hand for a part. */
export const uploadedDrawingKey = (teamId: string, partNumber: string) =>
  `${drawingsPrefix(teamId)}${partNumber}.pdf`;

/** A new part file's key (a fresh id, then a safe version of its name). */
export const partFileKey = (teamId: string, filename: string) =>
  `${teamPrefix(teamId)}part-files/${crypto.randomUUID()}-${
    filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "_"
  }`;
