import { type PointerEvent as ReactPointerEvent, useState } from "react";
import type { Attendee, Change, Day, Period, Role } from "../../shared/api";
import { roleBlock } from "../../shared/role-colors";
import { hourLabel, quarterLabel, shortTime, spanLabel, timeLabel } from "../../shared/time";
import { type Cells, cellKey, rowRanges } from "./cells";
import { PersonCard } from "./person-card";
import { SlotCard } from "./slot-card";
import type { Buttons, Tool } from "./tools";

// The whole team's day: a row per attendee, a column per 15-minute block, the event's periods in
// a band across the top. Dragging across people and times paints those blocks with the tool on
// the mouse button that started the drag (a role, or clearing); with none, it's just looking.

type Drag = { r0: number; s0: number; r1: number; s1: number; tool: Tool };

const HEADER_ROWS = 2;

export function Grid({
  day,
  attendees,
  periods,
  roles,
  cells,
  buttons,
  me,
  now,
  onPaint,
}: {
  day: Day;
  attendees: Attendee[];
  periods: Period[];
  roles: Map<number, Role>;
  cells: Cells;
  /** What each mouse button paints with; null for a viewer who can't edit. */
  buttons: Buttons | null;
  /** The viewer, whose row is marked. */
  me: string;
  /** The block it is now at the event, when it's this day. */
  now: number | null;
  onPaint: (change: Change) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  // A name (its minutes in each role) or a column's time (its counts) being hovered or focused.
  const [hover, setHover] = useState<
    (({ person: string } | { slot: number }) & { anchor: DOMRect }) | null
  >(null);
  /** Shows a card while an element is hovered or focused. */
  const hoverOn = (target: { person: string } | { slot: number }) => {
    const show = (e: { currentTarget: HTMLElement }) =>
      setHover({ ...target, anchor: e.currentTarget.getBoundingClientRect() });
    return {
      onMouseEnter: show,
      onFocus: show,
      onMouseLeave: () => setHover(null),
      onBlur: () => setHover(null),
    };
  };
  const slots = day.end - day.start;
  const column = (slot: number) => slot - day.start + 2;

  /** The attendee row and slot under a point, or null outside the blocks. */
  function cellAt(x: number, y: number) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot]");
    if (!el?.dataset.slot || el.dataset.row === undefined) return null;
    return { r: Number(el.dataset.row), s: Number(el.dataset.slot) };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Each mouse button paints with its own tool; a finger or pen with the left's.
    const tool =
      e.button === 0
        ? buttons?.left
        : e.button === 1
          ? buttons?.middle
          : e.button === 2
            ? buttons?.right
            : null;
    if (tool === null || tool === undefined) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ r0: cell.r, s0: cell.s, r1: cell.r, s1: cell.s, tool });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell && (cell.r !== drag.r1 || cell.s !== drag.s1)) {
      setDrag({ ...drag, r1: cell.r, s1: cell.s });
    }
  }

  function onPointerUp() {
    if (!drag) return;
    const { tool } = drag;
    const [rowFrom, rowTo] = [Math.min(drag.r0, drag.r1), Math.max(drag.r0, drag.r1)];
    setDrag(null);
    onPaint({
      userIds: attendees.slice(rowFrom, rowTo + 1).map((a) => a.userId),
      day: day.day,
      start: Math.min(drag.s0, drag.s1),
      end: Math.max(drag.s0, drag.s1) + 1,
      roleId: tool === "clear" ? null : tool,
    });
  }

  const columns = Array.from({ length: slots }, (_, i) => day.start + i);
  const toolRole = typeof drag?.tool === "number" ? roles.get(drag.tool) : undefined;
  const painting =
    buttons !== null &&
    (buttons.left !== null || buttons.middle !== null || buttons.right !== null);

  return (
    <div
      className="overflow-x-auto rounded-xl border border-secondary-200 bg-surface"
      // The card is placed by where the name was; it goes when the grid moves under it.
      onScroll={() => setHover(null)}
    >
      <div
        role="grid"
        aria-label={`Everyone's schedule, ${spanLabel(day.start, day.end)}`}
        className={`grid select-none ${painting ? "touch-none cursor-crosshair" : ""}`}
        style={{
          gridTemplateColumns: `minmax(8rem, 11rem) repeat(${slots}, minmax(2.5rem, 1fr))`,
          gridTemplateRows: `auto 1.75rem repeat(${attendees.length}, 2.25rem)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        // The middle button paints here, so the browser's middle-click scrolling doesn't start.
        onMouseDown={(e) => painting && e.button === 1 && e.preventDefault()}
      >
        {/* A time for every column: the hour on the hour, :15, :30 and :45 between */}
        <div
          className="sticky left-0 z-20 border-b border-secondary-200 bg-surface"
          style={{ gridRow: 1, gridColumn: 1 }}
        />
        {columns.map((slot, i) => {
          const onHour = slot % 4 === 0;
          return (
            <div
              key={slot}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: focusing a time shows its counts
              tabIndex={0}
              aria-label={timeLabel(slot)}
              aria-describedby={
                hover && "slot" in hover && hover.slot === slot ? "slot-card" : undefined
              }
              {...hoverOn({ slot })}
              className={`border-b border-secondary-200 px-1 py-1 text-xs whitespace-nowrap ${
                onHour
                  ? "border-l border-l-secondary-300 font-semibold text-secondary-800"
                  : "border-l border-l-secondary-100 text-secondary-400"
              }`}
              style={{ gridRow: 1, gridColumn: column(slot) }}
            >
              {onHour ? hourLabel(slot) : i === 0 ? shortTime(slot) : quarterLabel(slot)}
            </div>
          );
        })}

        {/* The event's periods */}
        <div
          className="sticky left-0 z-20 flex items-center border-b border-secondary-200 bg-surface px-3 text-xs font-semibold uppercase tracking-wide text-secondary-400"
          style={{ gridRow: 2, gridColumn: 1 }}
        >
          Event
        </div>
        <div
          className="border-b border-secondary-200 bg-inset"
          style={{ gridRow: 2, gridColumn: `2 / ${slots + 2}` }}
        />
        {periods.map((period) => (
          <div
            key={period.id}
            title={`${period.label}, ${spanLabel(period.start, period.end)}`}
            className="z-[1] m-0.5 flex items-center truncate rounded-md border border-secondary-300 bg-surface px-1.5 text-xs font-medium text-secondary-800"
            style={{ gridRow: 2, gridColumn: `${column(period.start)} / ${column(period.end)}` }}
          >
            {period.label}
          </div>
        ))}

        {/* A row per attendee: blocks to paint, and their roles drawn over them */}
        {attendees.map((attendee, r) => {
          const row = r + HEADER_ROWS + 1;
          const mine = attendee.userId === me;
          return [
            <div
              key={`name-${attendee.userId}`}
              className={`sticky left-0 z-20 flex items-center truncate border-b border-secondary-100 px-3 text-sm ${
                mine ? "bg-inset font-semibold text-secondary-900" : "bg-surface text-secondary-800"
              }`}
              style={{ gridRow: row, gridColumn: 1 }}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: focusing a name shows its minutes
              tabIndex={0}
              aria-describedby={
                hover && "person" in hover && hover.person === attendee.userId
                  ? "person-card"
                  : undefined
              }
              {...hoverOn({ person: attendee.userId })}
            >
              {attendee.displayName ?? "Former member"}
            </div>,
            ...Array.from({ length: slots }, (_, i) => {
              const slot = day.start + i;
              return (
                <div
                  key={`cell-${attendee.userId}-${slot}`}
                  data-row={r}
                  data-slot={slot}
                  className={`border-b border-secondary-100 ${
                    slot % 4 === 0
                      ? "border-l border-l-secondary-200"
                      : "border-l border-l-secondary-100"
                  } ${mine ? "bg-inset" : ""}`}
                  style={{ gridRow: row, gridColumn: column(slot) }}
                />
              );
            }),
            ...rowRanges(cells, attendee.userId, day.day).map((range) => {
              const role = roles.get(range.roleId);
              const look = roleBlock(role?.color ?? "gray");
              return (
                <div
                  key={`range-${attendee.userId}-${range.start}`}
                  title={`${role?.name ?? "Role"}, ${spanLabel(range.start, range.end)}`}
                  className={`pointer-events-none z-[1] m-0.5 flex min-w-0 items-center overflow-hidden rounded-md border px-1 text-xs font-medium whitespace-nowrap ${look.className}`}
                  style={{
                    ...look.style,
                    gridRow: row,
                    gridColumn: `${column(range.start)} / ${column(range.end)}`,
                  }}
                >
                  <span className="min-w-0 truncate">{role?.name}</span>
                </div>
              );
            }),
          ];
        })}

        {/* Where it is now */}
        {now !== null && now >= day.start && now < day.end && (
          <div
            aria-hidden
            className="pointer-events-none z-[2] border-l-2 border-primary-500"
            style={{
              gridRow: `1 / ${attendees.length + HEADER_ROWS + 1}`,
              gridColumn: column(now),
            }}
          />
        )}

        {/* What a drag will do */}
        {drag && (
          <div
            aria-hidden
            className={`pointer-events-none z-[3] rounded-md border-2 ${
              toolRole
                ? `${roleBlock(toolRole.color).className} opacity-80`
                : "border-dashed border-secondary-500 bg-secondary-900/10"
            }`}
            style={{
              ...(toolRole ? roleBlock(toolRole.color).style : undefined),
              gridRow: `${Math.min(drag.r0, drag.r1) + HEADER_ROWS + 1} / ${Math.max(drag.r0, drag.r1) + HEADER_ROWS + 2}`,
              gridColumn: `${column(Math.min(drag.s0, drag.s1))} / ${column(Math.max(drag.s0, drag.s1) + 1)}`,
            }}
          />
        )}
      </div>
      {hover && !drag && "person" in hover && (
        <PersonCard
          attendee={attendees.find((a) => a.userId === hover.person) ?? attendees[0]}
          cells={cells}
          day={day.day}
          roles={roles}
          anchor={hover.anchor}
        />
      )}
      {hover && !drag && "slot" in hover && (
        <SlotCard
          slot={hover.slot}
          day={day.day}
          attendees={attendees}
          cells={cells}
          roles={roles}
          anchor={hover.anchor}
        />
      )}
    </div>
  );
}

/** The blocks a change paints, for showing it before the worker answers. */
export function applyChange(cells: Cells, change: Change): Cells {
  const next = new Map(cells);
  for (const userId of change.userIds) {
    for (let slot = change.start; slot < change.end; slot++) {
      const key = cellKey(userId, change.day, slot);
      if (change.roleId === null) next.delete(key);
      else next.set(key, change.roleId);
    }
  }
  return next;
}
