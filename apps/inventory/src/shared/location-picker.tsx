import { type Places, pathOf } from "./places";
import { inputClass } from "./ui";

/**
 * Picks a location from the tree, a level at a time: the top-level place, then what's inside it,
 * as far down as needed. Parts can be kept at any level.
 */
export function LocationPicker({
  places,
  value,
  onChange,
  label = "Location",
  emptyLabel = "Pick a location…",
}: {
  places: Places;
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
  /** The top level's choice for no location (a filter's "All locations"). */
  emptyLabel?: string;
}) {
  const path = pathOf(value, places);
  // One select per level already chosen, and one more if the last has places inside it.
  const levels = [null, ...path.map((row) => row.id)].filter(
    (parentId) => (places.childrenOf.get(parentId) ?? []).length > 0,
  );
  if (levels.length === 0) {
    return <p className="text-sm text-secondary-500">No locations have been set up yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      {levels.map((parentId, level) => (
        <select
          key={parentId ?? "top"}
          className={inputClass}
          aria-label={level === 0 ? label : `${label}, inside ${path[level - 1]?.name}`}
          value={path[level]?.id ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : parentId)}
        >
          <option value="">{level === 0 ? emptyLabel : "(right here)"}</option>
          {(places.childrenOf.get(parentId) ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
