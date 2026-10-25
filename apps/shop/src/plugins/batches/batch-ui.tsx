import { Badge, focusRing, tones } from "@g3/ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { batchComplete, batchStage, batchStatusText } from "../../shared/batches";
import { partFileDownloadUrl } from "../../shared/getters";
import { detailsViewPath, partPath } from "../../shared/nav";
import type { Batch, PartDefinition, PartFile } from "../../shared/types";
import { useKiosk } from "../../shared/use-auth";

/** A name that opens something: the team's color, underlined. */
export const linkClass = "text-primary-600 underline hover:text-primary-700 transition-colors";

export const formatDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A batch's name, which opens its detail view over the page it's on (`?batch=`, read by
 * `BatchSheet`), so closing it comes back to where it was opened.
 */
export function BatchLink({
  batch,
  className = linkClass,
  children,
}: {
  batch: Pick<Batch, "id" | "label">;
  className?: string;
  children?: ReactNode;
}) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set("batch", String(batch.id));
  return (
    <Link
      to={{ pathname: location.pathname, search: `?${search}` }}
      onClick={(e) => e.stopPropagation()}
      title="Open this batch"
      className={className}
    >
      {children ?? batch.label}
    </Link>
  );
}

/** Where a batch is: "To Do at CAM", "In Progress at Router", "Complete". */
export function BatchStatusBadge({
  batch,
  processName,
}: {
  batch: Batch;
  processName: (id: number) => string;
}) {
  const colors = batchComplete(batch)
    ? tones.success
    : batchStage(batch).status === "doing"
      ? tones.warning
      : tones.neutral;
  const text = batchStatusText(batch, processName);
  return (
    <Badge colors={colors} title={text}>
      {text}
    </Badge>
  );
}

/** A file's name, which downloads it. */
export function FileLink({ file, className = linkClass }: { file: PartFile; className?: string }) {
  return (
    <a
      href={partFileDownloadUrl(file.id)}
      download={file.filename}
      title="Download this file"
      className={className}
    >
      {file.filename}
    </a>
  );
}

/**
 * A part's name, which opens everything with its part number. Plain text on a kiosk, which only
 * has its machine's page.
 */
export function PartNameLink({
  definition,
  className = linkClass,
}: {
  definition: Pick<PartDefinition, "onshapePartNumber" | "name">;
  className?: string;
}) {
  const kiosk = useKiosk();
  const name = definition.name || definition.onshapePartNumber;
  if (kiosk.active) return <>{name}</>;
  return (
    <Link
      to={partPath(definition.onshapePartNumber)}
      onClick={(e) => e.stopPropagation()}
      title="Open this part"
      className={className}
    >
      {name}
    </Link>
  );
}

/**
 * Where an instance's details view is. On a kiosk, which only has its machine's page, that's the
 * page it's on with the part's card over it.
 */
export function useInstancePath() {
  const kiosk = useKiosk();
  const location = useLocation();
  return (instanceId: number) =>
    kiosk.active
      ? { pathname: location.pathname, search: `?instance=${instanceId}` }
      : detailsViewPath(instanceId);
}

/** A part's name and instance number, which open that instance's details view. */
export function InstanceLink({
  instanceId,
  className = linkClass,
  children,
}: {
  instanceId: number;
  className?: string;
  children: ReactNode;
}) {
  const instancePath = useInstancePath();
  return (
    <Link
      to={instancePath(instanceId)}
      onClick={(e) => e.stopPropagation()}
      title="Open this part's details"
      className={className}
    >
      {children}
    </Link>
  );
}

/** The small "Priority" mark on a part's line in a list. */
export function PriorityTag() {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 shrink-0">
      Priority
    </span>
  );
}

/** Beside the other buttons of a list row (`sm`, and `touch` on a touch screen) or of a page. */
export type CompleteSize = "sm" | "touch" | "md";

const COMPLETE_SIZES: Record<CompleteSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  touch: "px-4 py-2.5 text-xs",
  md: "px-3.5 py-2 text-sm",
};

/**
 * The green button that marks work complete, as the Shop Floor's lists draw it, with what to
 * check first (`hint`) shown above it on hover. Shop's own: the shared `Button` has no variant
 * for it.
 */
export function CompleteButton({
  size = "sm",
  hint,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: CompleteSize; hint?: string }) {
  const button = (
    <button
      type="button"
      {...props}
      className={`whitespace-nowrap bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 ${focusRing} ${COMPLETE_SIZES[size]} ${className}`}
    />
  );
  if (!hint) return button;
  return (
    <span className="relative group">
      {button}
      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:block whitespace-nowrap bg-secondary-900 text-surface text-xs rounded-md px-2.5 py-1.5 shadow-lg">
        {hint}
      </span>
    </span>
  );
}
