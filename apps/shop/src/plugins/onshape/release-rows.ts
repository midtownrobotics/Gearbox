import type { OnshapeRelease } from "../../shared/types";

// What the Onshape page's table shows and in what order: which releases and parts a search and
// the obsolete switch leave, sorted by one of a release's columns (each release once, with its
// parts) or by one of a part's (every part on a line of its own).

export type Part = OnshapeRelease["parts"][number];
/** A release and the parts of it that are shown. */
export type Group = { release: OnshapeRelease; parts: Part[] };
/** One part with the release it came in. */
export type Line = { release: OnshapeRelease; part: Part };

export const SORTS = ["released", "madeBy", "approvedBy", "part", "number", "quantity"] as const;
export type SortKey = (typeof SORTS)[number];
export type Sort = { key: SortKey; dir: "asc" | "desc" };

/** A part's own columns: sorting by one takes the parts out of their releases. */
export const PART_SORTS: SortKey[] = ["part", "number", "quantity"];

export const startingDir = (key: SortKey) =>
  key === "released" || key === "quantity" ? "desc" : "asc";

const has = (text: string | null | undefined, q: string) => !!text?.toLowerCase().includes(q);

export const approvedBy = (release: OnshapeRelease) =>
  release.approvers
    .filter((a) => a.approvedAt)
    .map((a) => a.name)
    .join(", ");

/** What a part is called: its name, or its number when it has none of its own. */
export const partName = (part: Part) => part.name || part.partNumber;

/** The parts of a release to show, or null when the search leaves the release out. */
export function shownGroup(
  release: OnshapeRelease,
  query: string,
  showObsolete: boolean,
): Group | null {
  const q = query.trim().toLowerCase();
  const parts = release.parts.filter((p) => showObsolete || !p.obsolete);
  if (!q) return { release, parts };
  const own = [
    release.name,
    release.notes,
    release.madeBy,
    ...release.approvers.map((a) => a.name),
  ];
  if (own.some((f) => has(f, q))) return { release, parts };
  const matching = parts.filter((p) => [p.partNumber, p.name].some((f) => has(f, q)));
  return matching.length > 0 ? { release, parts: matching } : null;
}

// Blanks go last whichever way the column is sorted.
function byText(a: string | null, b: string | null, dir: 1 | -1) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return dir * a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function byNumber(a: number | null, b: number | null, dir: 1 | -1) {
  if (a === null || b === null) return a !== null ? -1 : b !== null ? 1 : 0;
  return dir * (a - b);
}

const newestFirst = (a: OnshapeRelease, b: OnshapeRelease) =>
  (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0) || b.id - a.id;

/** Releases in the order of one of their own columns; releases that tie are newest first. */
export function sortGroups(groups: Group[], { key, dir }: Sort): Group[] {
  const d = dir === "asc" ? 1 : -1;
  return [...groups].sort(({ release: a }, { release: b }) =>
    key === "madeBy"
      ? byText(a.madeBy, b.madeBy, d) || newestFirst(a, b)
      : key === "approvedBy"
        ? byText(approvedBy(a), approvedBy(b), d) || newestFirst(a, b)
        : -d * newestFirst(a, b),
  );
}

/** Every part on a line of its own, in the order of one of a part's columns. */
export function sortLines(groups: Group[], { key, dir }: Sort): Line[] {
  const d = dir === "asc" ? 1 : -1;
  return groups
    .flatMap(({ release, parts }) => parts.map((part) => ({ release, part })))
    .sort(
      (a, b) =>
        (key === "part"
          ? byText(partName(a.part), partName(b.part), d)
          : key === "number"
            ? byText(a.part.partNumber, b.part.partNumber, d) ||
              byText(a.part.revision, b.part.revision, d)
            : byNumber(a.part.quantity, b.part.quantity, d)) ||
        newestFirst(a.release, b.release) ||
        byText(a.part.partNumber, b.part.partNumber, 1),
    );
}
