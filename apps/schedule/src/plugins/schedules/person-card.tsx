import type { Attendee, Role } from "../../shared/api";
import { Swatch } from "../../shared/role-colors";
import { dayLabel } from "../../shared/time";
import { type Cells, minutesByRole } from "./cells";

// What a person has been given, shown beside their name on the grid: minutes in each role on
// the day shown and over the whole event. Fixed to the window, so the grid's scrolling doesn't
// cut it off.

const minutes = (n: number | undefined) => (n ? `${n} min` : "–");

export function PersonCard({
  attendee,
  cells,
  day,
  roles,
  anchor,
}: {
  attendee: Attendee;
  cells: Cells;
  day: string;
  roles: Map<number, Role>;
  /** The name it's beside. */
  anchor: DOMRect;
}) {
  const today = minutesByRole(cells, attendee.userId, day);
  const event = minutesByRole(cells, attendee.userId);
  const rows = [...event.keys()]
    .map((id) => ({ id, role: roles.get(id) }))
    .sort((a, b) => (event.get(b.id) ?? 0) - (event.get(a.id) ?? 0));
  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  // Below the name's top in the upper half of the window, above its bottom in the lower half.
  const below = anchor.top < window.innerHeight / 2;
  return (
    <div
      id="person-card"
      role="tooltip"
      className="pointer-events-none fixed z-50 w-72 rounded-xl border border-secondary-200 bg-surface p-3 text-sm shadow-xl"
      style={{
        left: Math.min(anchor.right + 8, window.innerWidth - 296),
        ...(below ? { top: anchor.top } : { bottom: window.innerHeight - anchor.bottom }),
      }}
    >
      <p className="font-semibold text-secondary-900">{attendee.displayName ?? "Former member"}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-secondary-500">Nothing assigned yet.</p>
      ) : (
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-xs text-secondary-500">
              <th className="pb-1 text-left font-medium">Role</th>
              <th className="pb-1 text-right font-medium">{dayLabel(day)}</th>
              <th className="pb-1 text-right font-medium">Event</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, role }) => (
              <tr key={id}>
                <td className="py-0.5">
                  <span className="inline-flex items-center gap-1.5 text-secondary-800">
                    <Swatch color={role?.color ?? "gray"} />
                    {role?.name ?? "Role"}
                  </span>
                </td>
                <td className="py-0.5 text-right tabular-nums text-secondary-800">
                  {minutes(today.get(id))}
                </td>
                <td className="py-0.5 text-right tabular-nums text-secondary-800">
                  {minutes(event.get(id))}
                </td>
              </tr>
            ))}
            <tr className="border-t border-secondary-200 font-semibold text-secondary-900">
              <td className="pt-1">Total</td>
              <td className="pt-1 text-right tabular-nums">{minutes(sum(today))}</td>
              <td className="pt-1 text-right tabular-nums">{minutes(sum(event))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
