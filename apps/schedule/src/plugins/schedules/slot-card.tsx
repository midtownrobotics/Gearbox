import type { Attendee, Role } from "../../shared/api";
import { Swatch } from "../../shared/role-colors";
import { spanLabel } from "../../shared/time";
import { type Cells, cellKey } from "./cells";
import { HoverCard } from "./hover-card";

// One 15-minute block, shown under its time on the grid: how many people have each role then,
// and how many have nothing.

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export function SlotCard({
  slot,
  day,
  attendees,
  cells,
  roles,
  anchor,
}: {
  slot: number;
  day: string;
  attendees: Attendee[];
  cells: Cells;
  roles: Map<number, Role>;
  anchor: DOMRect;
}) {
  const counts = new Map<number, number>();
  for (const attendee of attendees) {
    const roleId = cells.get(cellKey(attendee.userId, day, slot));
    if (roleId !== undefined) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
  }
  const assigned = [...counts.values()].reduce((a, b) => a + b, 0);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <HoverCard id="slot-card" anchor={anchor} placement="below">
      <p className="font-semibold text-secondary-900">{spanLabel(slot, slot + 1)}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-secondary-500">No one is assigned.</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {rows.map(([roleId, count]) => {
            const role = roles.get(roleId);
            return (
              <li key={roleId} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-secondary-800">
                  <Swatch color={role?.color ?? "gray"} />
                  {role?.name ?? "Role"}
                </span>
                <span className="tabular-nums text-secondary-800">{people(count)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {attendees.length > assigned && (
        <p className="mt-2 border-t border-secondary-200 pt-1.5 text-secondary-500">
          Nothing assigned: {people(attendees.length - assigned)}
        </p>
      )}
    </HoverCard>
  );
}
