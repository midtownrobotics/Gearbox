import { Badge } from "@g3/ui";
import type { ReactNode } from "react";
import type { OnshapeRelease } from "../../shared/types";
import { linkClass } from "../batches/batch-ui";

// Pieces the Onshape list and a release's page share.

type Part = OnshapeRelease["parts"][number];

export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

export const th =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-secondary-400";
export const td = "px-3 py-2 align-top";

export function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={linkClass}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}

/** A part's number and revision: "1648-26-P-0010 · Rev C". Struck out when it's obsolete. */
export function PartNumber({ part }: { part: Part }) {
  const struck = part.obsolete ? "line-through" : "";
  return (
    <>
      <span className={`font-mono ${struck}`}>{part.partNumber}</span>
      {part.revision && <span className={struck}> · Rev {part.revision}</span>}
    </>
  );
}

/**
 * A part on a phone, where a table's columns don't fit: its name (struck out, with a badge, when
 * it's obsolete) over its number and revision, and its quantity at the right.
 */
export function NarrowPart({
  part,
  name,
  children,
  className = "",
}: {
  part: Part;
  /** The part's name as the page shows it: a link, or plain text. */
  name: ReactNode;
  /** More about the part, under its number. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-3 px-3 py-2 ${className}`}>
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`break-words font-medium ${part.obsolete ? "line-through" : ""}`}>
            {name}
          </span>
          {part.obsolete && <Badge>Obsolete</Badge>}
        </span>
        <span className="block break-words text-xs text-secondary-500">
          <PartNumber part={part} />
        </span>
        {children}
      </div>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-secondary-900">
        <span className="text-xs text-secondary-400">Qty </span>
        {part.quantity ?? "–"}
      </span>
    </div>
  );
}
