import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { InstanceRow } from "../../shared/derive";
import { detailsViewPath } from "../../shared/nav";
import { PrintDrawingButton } from "../../shared/print-drawing-button";
import { projectName } from "../../shared/projects";
import type { ShopData } from "../../shared/use-shop-data";
import { DrawingPreview } from "../parts/drawing-preview";

/** A button in the shop view's panel: big enough for a finger, and bigger beside the drawing. */
export const shopButton =
  "flex w-full items-center justify-center rounded-lg px-3 py-3 text-center text-sm font-semibold transition-colors disabled:opacity-50 sm:text-base lg:px-6 lg:py-4 lg:text-lg";

/** One that doesn't change anything: closing, switching views. */
export const shopButtonPlain = `${shopButton} border border-secondary-200 bg-inset text-secondary-500 hover:border-secondary-400 hover:bg-secondary-200 active:bg-secondary-200`;

/**
 * A part at its machine, over the whole screen: its drawing, what it is, and the buttons for
 * working on it (`children`, after Print Drawing and the switch to its details). The panel is
 * beside the drawing on a wide screen and under it on a narrow one, where a column that narrow
 * can't hold its text.
 */
export function ShopView({
  row,
  data,
  onClose,
  banner,
  children,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  banner?: string | null;
  children: ReactNode;
}) {
  const subsystem = data.subsystems.find((s) => s.id === row.definition.subsystemId);
  const facts: { label: string; value: string; mono?: boolean; wide?: boolean }[] = [
    { label: "Name", value: row.definition.name || "—", wide: true },
    { label: "Part Number", value: row.definition.onshapePartNumber, mono: true },
    { label: "Revision", value: row.definition.revision || "—" },
    { label: "Instance", value: `#${row.instance.instanceNumber}` },
    { label: "Subsystem", value: subsystem?.name || "—" },
    ...(data.projects.length > 1
      ? [{ label: "Project", value: projectName(data.projects, subsystem?.projectId) }]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-secondary-200 px-4 py-3 lg:px-6 lg:py-5">
        <h1 className="min-w-0 truncate font-display text-2xl text-secondary-900 lg:text-3xl">
          {row.definition.name}
          <span className="ml-2 font-normal text-secondary-400">
            #{row.instance.instanceNumber}
          </span>
        </h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-3xl text-secondary-400 transition-colors hover:text-secondary-900"
        >
          ✕
        </button>
      </div>

      {banner && (
        <div className="border-b border-red-300 bg-red-50 px-4 py-3 lg:px-6">
          <p className="text-sm text-red-800">{banner}</p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 border-b border-secondary-200 bg-surface lg:border-b-0 lg:border-r">
          <DrawingPreview
            partNumber={row.definition.onshapePartNumber}
            revision={row.definition.revision}
            hideOverlay
            fullHeight
          />
        </div>

        <div className="flex max-h-[60%] shrink-0 flex-col overflow-y-auto p-4 lg:max-h-none lg:w-1/4 lg:p-6">
          <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 sm:grid-cols-4 lg:flex-1 lg:grid-cols-1 lg:gap-y-5">
            {facts.map((fact) => (
              <div key={fact.label} className={fact.wide ? "col-span-full" : undefined}>
                <dt className="text-xs font-semibold text-secondary-400 lg:mb-2 lg:text-sm">
                  {fact.label}
                </dt>
                <dd
                  className={`break-words text-sm text-secondary-900 lg:text-base ${fact.mono ? "font-mono" : ""}`}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
            {row.definition.notes && (
              <div className="col-span-full">
                <dt className="text-xs font-semibold text-secondary-400 lg:mb-2 lg:text-sm">
                  Notes
                </dt>
                <dd className="whitespace-pre-wrap text-sm text-secondary-900 lg:text-base">
                  {row.definition.notes}
                </dd>
              </div>
            )}
            {row.instance.isPriority ? (
              <div className="col-span-full">
                <span className="inline-block rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  Priority
                </span>
              </div>
            ) : null}
          </dl>

          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-secondary-200 pt-4 lg:mt-6 lg:grid-cols-1 lg:gap-3 lg:pt-6">
            <PrintDrawingButton
              partNumber={row.definition.onshapePartNumber}
              revision={row.definition.revision}
              size="kiosk"
            />
            <Link
              to={detailsViewPath(row.instance.id)}
              onClick={onClose}
              className={shopButtonPlain}
            >
              Switch to details view
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
