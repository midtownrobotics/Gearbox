/** One CSV line: fields quoted when they contain a comma, quote or line break. */
export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields
    .map((f) => {
      const s = f === null || f === undefined ? "" : String(f);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

/** "$1,234.50" style without the thousands separator, like the team's sheet ("$1234.50"). */
export const csvMoney = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : `$${(cents / 100).toFixed(2)}`;

/** M/D/YYYY in the shop's time zone, like the team's sheet. */
export const csvDate = (ms: number | null | undefined) =>
  ms === null || ms === undefined
    ? ""
    : new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York" });

/**
 * Parses CSV text (RFC 4180: quoted fields may contain commas, "" quotes and line breaks) into
 * rows of fields. A leading byte-order mark is ignored.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
