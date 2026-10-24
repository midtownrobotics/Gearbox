import { Badge, focusRing } from "@g3/ui";
import { Link, useLocation } from "react-router-dom";
import type { OnshapeRelease } from "../../shared/types";
import { PartNameLink, linkClass } from "../batches/batch-ui";
import {
  type Group,
  type Line,
  type Part,
  type Sort,
  type SortKey,
  approvedBy,
  releaseName,
} from "./release-rows";
import { NarrowPart, PartNumber, td, th, when } from "./release-ui";

// The Onshape page's table, drawn two ways. From 768px it is a table: a release's cells run down
// beside its parts, or, with parts on lines of their own, are repeated on every line. Below that
// nothing scrolls sideways: a release is a shaded band with its parts under it, or each part is
// two lines, the part and then its release. Both sort by the same seven columns.

type Props = {
  /** Releases with their parts; used unless `flat`. */
  grouped: Group[];
  /** Every part on a line of its own; used when `flat`. */
  lines: Line[];
  flat: boolean;
  sort: Sort;
  onSort: (key: SortKey) => void;
};

export function ReleasesTable(props: Props) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-secondary-200 bg-surface text-sm">
      <WideTable {...props} />
      <NarrowList {...props} />
    </div>
  );
}

// The line above a release (or, with parts on their own lines, above every line), the fainter one
// between the parts of one release, and the line down the table where the parts' columns begin.
const groupEdge = "border-t border-t-secondary-300";
const partEdge = "border-t border-t-secondary-100";
const partsEdge = "border-l border-l-secondary-200";

const noParts = (release: OnshapeRelease) =>
  release.parts.length === 0 ? "No parts were recorded." : "Its parts are all obsolete.";

function WideTable({ grouped, lines, flat, sort, onSort }: Props) {
  const header = (k: SortKey, label: string, className = "") => (
    <th
      scope="col"
      aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={`${th} ${className}`}
    >
      <SortButton k={k} label={label} sort={sort} onSort={onSort} />
    </th>
  );
  return (
    <table className="hidden w-full md:table">
      <thead className="bg-page">
        <tr>
          <th scope="colgroup" colSpan={4} className={`${th} pb-0`}>
            Release
          </th>
          <th scope="colgroup" colSpan={3} className={`${th} ${partsEdge} pb-0`}>
            Parts
          </th>
        </tr>
        <tr>
          {header("name", "Name")}
          {header("released", "Released")}
          {header("madeBy", "Made by")}
          {header("approvedBy", "Approved by")}
          {header("part", "Part", partsEdge)}
          {header("number", "Number")}
          {header("quantity", "Qty", "text-right")}
        </tr>
      </thead>
      <tbody>
        {flat
          ? lines.map(({ release, part }) => (
              <tr key={part.id}>
                <ReleaseCells release={release} edge={groupEdge} />
                <PartCells part={part} edge={groupEdge} />
              </tr>
            ))
          : grouped.map(({ release, parts }) =>
              parts.length === 0 ? (
                <tr key={release.id}>
                  <ReleaseCells release={release} edge={groupEdge} />
                  <td colSpan={3} className={`${td} ${groupEdge} ${partsEdge} text-secondary-400`}>
                    {noParts(release)}
                  </td>
                </tr>
              ) : (
                parts.map((part, i) => (
                  <tr key={part.id}>
                    {i === 0 && (
                      <ReleaseCells release={release} edge={groupEdge} rows={parts.length} />
                    )}
                    <PartCells part={part} edge={i === 0 ? groupEdge : partEdge} />
                  </tr>
                ))
              ),
            )}
      </tbody>
    </table>
  );
}

function NarrowList({ grouped, lines, flat, sort, onSort }: Props) {
  const button = (k: SortKey, label: string) => (
    <SortButton k={k} label={label} sort={sort} onSort={onSort} spoken />
  );
  const releaseSorts = (
    <div className="flex flex-wrap gap-x-4">
      {button("name", "Name")}
      {button("released", "Released")}
      {button("madeBy", "Made by")}
      {button("approvedBy", "Approved by")}
    </div>
  );
  const partSorts = (
    <div className="flex flex-wrap gap-x-4">
      {button("part", "Part")}
      {button("number", "Number")}
      <span className="ml-auto">{button("quantity", "Qty")}</span>
    </div>
  );
  return (
    <div className="md:hidden">
      {/* The sort buttons, in the order of the lines under them. */}
      <div className="bg-page px-3 py-1 text-xs font-semibold uppercase tracking-wide text-secondary-400">
        {flat ? partSorts : releaseSorts}
        {flat ? releaseSorts : partSorts}
      </div>
      {flat ? (
        <ul>
          {lines.map(({ release, part }) => (
            // Every other part is shaded, so each pair of lines reads as one.
            <li key={part.id} className={`${groupEdge} even:bg-inset`}>
              <NarrowPart part={part} name={<PartName part={part} />} />
              <p className="border-t border-dashed border-t-secondary-200 px-3 py-1.5 text-xs text-secondary-500">
                <ReleaseLink release={release} />
                {[released(release), people(release)]
                  .map((text) => (text ? ` · ${text}` : ""))
                  .join("")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        grouped.map(({ release, parts }) => (
          <section key={release.id} className={groupEdge}>
            <div className="bg-inset px-3 py-2">
              <ReleaseLink release={release} className="font-medium" />
              <span className="block text-secondary-900">{released(release)}</span>
              {people(release) && (
                <span className="block text-xs text-secondary-500">{people(release)}</span>
              )}
            </div>
            {parts.length === 0 ? (
              <p className={`${partEdge} px-3 py-2 text-secondary-400`}>{noParts(release)}</p>
            ) : (
              parts.map((part) => (
                <NarrowPart
                  key={part.id}
                  part={part}
                  name={<PartName part={part} />}
                  className={partEdge}
                />
              ))
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** "Made by Avery Park · Approved by Dana Cho", for a line with no column headers over it. */
const people = (release: OnshapeRelease) =>
  [
    release.madeBy && `Made by ${release.madeBy}`,
    approvedBy(release) && `Approved by ${approvedBy(release)}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** A column's name, which sorts by it; again to turn the order round. */
function SortButton({
  k,
  label,
  sort,
  onSort,
  spoken = false,
}: {
  k: SortKey;
  label: string;
  sort: Sort;
  onSort: (key: SortKey) => void;
  /** Outside a table's header, which says so itself: read the order aloud. */
  spoken?: boolean;
}) {
  const active = sort.key === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 rounded py-1 font-semibold uppercase tracking-wide ${focusRing} ${
        active ? "text-secondary-900" : "hover:text-secondary-900"
      }`}
    >
      {label}
      <span aria-hidden className={active ? "" : "invisible"}>
        {sort.dir === "asc" || !active ? "↑" : "↓"}
      </span>
      {spoken && active && (
        <span className="sr-only">, sorted {sort.dir === "asc" ? "ascending" : "descending"}</span>
      )}
    </button>
  );
}

/** When a release was released: "Oct 5, 2026, 9:05 AM". */
const released = (release: OnshapeRelease) => when(release.releasedAt) ?? release.releasedAt;

/** A release's name, which opens its page. */
function ReleaseLink({ release, className = "" }: { release: OnshapeRelease; className?: string }) {
  // The release's back link returns to the table as it is now.
  const { search } = useLocation();
  return (
    <Link
      to={`/onshape/releases/${release.id}`}
      state={{ list: search }}
      title="Open this release"
      className={`${linkClass} break-words ${className}`}
    >
      {releaseName(release)}
    </Link>
  );
}

/** A part's name, which opens its page. */
function PartName({ part }: { part: Part }) {
  return (
    <PartNameLink definition={{ onshapePartNumber: part.partNumber, name: part.name ?? "" }} />
  );
}

/** A release's own cells: its name, when it was released, who made it, who approved it. */
function ReleaseCells({
  release,
  edge,
  rows,
}: {
  release: OnshapeRelease;
  edge: string;
  rows?: number;
}) {
  return (
    <>
      <td rowSpan={rows} className={`${td} ${edge}`}>
        <ReleaseLink release={release} />
      </td>
      {/* On one line once there's room: seven columns are a tight fit just above a phone's width. */}
      <td rowSpan={rows} className={`${td} ${edge} text-secondary-900 lg:whitespace-nowrap`}>
        {released(release)}
      </td>
      <td rowSpan={rows} className={`${td} ${edge} text-secondary-900`}>
        {release.madeBy ?? "–"}
      </td>
      <td rowSpan={rows} className={`${td} ${edge} text-secondary-900`}>
        {approvedBy(release) || "–"}
      </td>
    </>
  );
}

/** A part's cells. An obsolete one is struck out, as a part sent back out of a batch is. */
function PartCells({ part, edge }: { part: Part; edge: string }) {
  const tone = part.obsolete ? "text-secondary-500" : "text-secondary-900";
  return (
    <>
      <td className={`${td} ${edge} ${partsEdge}`}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={part.obsolete ? "line-through" : ""}>
            <PartName part={part} />
          </span>
          {part.obsolete && <Badge>Obsolete</Badge>}
        </span>
      </td>
      <td className={`${td} ${edge} whitespace-nowrap ${tone}`}>
        <PartNumber part={part} />
      </td>
      <td className={`${td} ${edge} text-right tabular-nums ${tone}`}>{part.quantity ?? "–"}</td>
    </>
  );
}
