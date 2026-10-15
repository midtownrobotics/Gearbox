import type { ReactNode } from "react";

// A card shown while something on the grid is hovered or focused: a person's minutes, a block's
// counts. Fixed to the window, so the grid's scrolling doesn't cut it off.

const WIDTH = 288;

export function HoverCard({
  id,
  anchor,
  placement,
  children,
}: {
  id: string;
  /** What it's about, on the page. */
  anchor: DOMRect;
  /** Beside it (a name) or under it (a column's time). */
  placement: "right" | "below";
  children: ReactNode;
}) {
  const room = window.innerWidth - WIDTH - 8;
  const style =
    placement === "right"
      ? {
          left: Math.min(anchor.right + 8, room),
          // Level with its top in the upper half of the window, with its bottom in the lower.
          ...(anchor.top < window.innerHeight / 2
            ? { top: anchor.top }
            : { bottom: window.innerHeight - anchor.bottom }),
        }
      : { left: Math.max(8, Math.min(anchor.left, room)), top: anchor.bottom + 6 };
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-xl border border-secondary-200 bg-surface p-3 text-sm shadow-xl"
      style={{ ...style, width: WIDTH }}
    >
      {children}
    </div>
  );
}
