import type { StockView } from "@g3/worker-inventory";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthUser } from "../../shared/auth";
import { valueText } from "../../shared/field-inputs";
import { count } from "../../shared/format";
import { useInventory } from "../../shared/inventory-data";
import { LocationPicker } from "../../shared/location-picker";
import { type Places, locationLabel, useLabel, withinLocation } from "../../shared/places";
import { type Row, rowsOf } from "../../shared/rows";
import {
  CheckButton,
  LocationButton,
  QuantityCell,
  type StockAction,
  StockActionDialog,
} from "../../shared/stock-cells";
import { Card, Page, StatusBadge, inputClass } from "../../shared/ui";

/** How many rows are drawn at first, and how many more each "Show more" adds. */
const PAGE_ROWS = 200;

type Filters = {
  query: string;
  status: "" | "storage" | "in_use";
  locationId: number | null;
  robotId: number | null;
};

function useRows(filters: Filters) {
  const { items, fields, places } = useInventory();
  return useMemo(() => {
    const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
    const inside = filters.locationId === null ? null : withinLocation(filters.locationId, places);
    const rows: Row[] = [];
    for (const item of items) {
      // What an entry can be found by: its name, its fields, and how it's bought.
      const about = [
        item.name,
        ...fields.map((field) => valueText(field, item.values[field.id])),
        ...item.listings.flatMap((listing) => [listing.vendor, listing.sku ?? ""]),
      ].join(" ");
      for (const row of rowsOf(item)) {
        const { stock } = row;
        if (filters.status && stock?.status !== filters.status) continue;
        if (inside && !(stock && inside.has(stock.locationId))) continue;
        if (filters.robotId !== null && stock?.robotId !== filters.robotId) continue;
        if (words.length > 0) {
          const text = `${about} ${stock ? rowPlace(stock, places) : ""}`.toLowerCase();
          if (!words.every((word) => text.includes(word))) continue;
        }
        rows.push(row);
      }
    }
    return rows;
  }, [items, fields, places, filters]);
}

const rowPlace = (stock: StockView, places: Places) =>
  `${locationLabel(stock.locationId, places)} ${useLabel(stock, places)}`;

/**
 * The main table: everything the team has cataloged, a row for each place an entry has parts.
 * Quantities and locations are changed right here, and parts are checked out to a robot or back
 * in.
 */
export function TablePage() {
  const { items, fields, places } = useInventory();
  const user = useAuthUser();
  const [filters, setFilters] = useState<Filters>({
    query: "",
    status: "",
    locationId: null,
    robotId: null,
  });
  const [shown, setShown] = useState(PAGE_ROWS);
  const [action, setAction] = useState<StockAction | null>(null);
  const rows = useRows(filters);
  const columns = fields.filter((field) => field.showInTable);
  const change = (next: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setShown(PAGE_ROWS);
  };
  const filtered =
    filters.query || filters.status || filters.locationId !== null || filters.robotId !== null;

  return (
    <Page
      title="Inventory"
      wide
      actions={
        <Link
          to="/new"
          className="rounded-lg bg-primary-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-600"
        >
          Add an entry
        </Link>
      }
    >
      {items.length === 0 ? (
        <Card>
          <p className="text-secondary-700">Nothing has been cataloged yet.</p>
          <p className="mt-1 text-sm text-secondary-500">
            {places.locations.length === 0
              ? user.isAdmin
                ? "Set up locations on Settings, then add entries here."
                : "Once an admin sets up locations on Settings, anyone can add entries here."
              : "Add the first entry with the button above."}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="search"
              className={inputClass}
              placeholder="Search name, details, vendor, location…"
              aria-label="Search the inventory"
              value={filters.query}
              onChange={(e) => change({ query: e.target.value })}
            />
            <select
              className={inputClass}
              aria-label="Status"
              value={filters.status}
              onChange={(e) => change({ status: e.target.value as Filters["status"] })}
            >
              <option value="">In storage and in use</option>
              <option value="storage">In storage</option>
              <option value="in_use">In use</option>
            </select>
            <LocationPicker
              places={places}
              value={filters.locationId}
              onChange={(locationId) => change({ locationId })}
              label="Location"
              emptyLabel="All locations"
            />
            {places.robots.length > 0 && (
              <select
                className={inputClass}
                aria-label="Robot"
                value={filters.robotId ?? ""}
                onChange={(e) =>
                  change({ robotId: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">Any robot</option>
                {places.robots.map((robot) => (
                  <option key={robot.id} value={robot.id}>
                    On {robot.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <p className="text-sm text-secondary-500">
            {filtered
              ? `${count(rows.length, "row")} of ${count(items.length, "entry", "entries")} match`
              : count(items.length, "entry", "entries")}
          </p>

          <div className="overflow-x-auto rounded-xl border border-secondary-200 bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-secondary-200 text-xs font-bold uppercase tracking-wider text-secondary-400">
                  <th className="px-4 py-2.5">Entry</th>
                  {columns.map((field) => (
                    <th key={field.id} className="px-3 py-2.5">
                      {field.name}
                    </th>
                  ))}
                  <th className="px-3 py-2.5">Qty</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {rows.slice(0, shown).map(({ item, stock }) => (
                  <tr key={stock ? `s${stock.id}` : `i${item.id}`} className="align-top">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/items/${item.id}`}
                        className="font-semibold text-secondary-900 hover:text-primary-600"
                      >
                        {item.name}
                      </Link>
                    </td>
                    {columns.map((field) => (
                      <td key={field.id} className="max-w-56 px-3 py-2.5 text-secondary-700">
                        <span className="line-clamp-2">
                          {valueText(field, item.values[field.id])}
                        </span>
                      </td>
                    ))}
                    {stock ? (
                      <>
                        <td className="px-3 py-1.5">
                          <QuantityCell stock={stock} />
                        </td>
                        <td className="px-3 py-2.5">
                          <LocationButton
                            label={locationLabel(stock.locationId, places)}
                            onClick={() => setAction({ kind: "move", item, stock })}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={stock.status} />
                          {stock.status === "in_use" && (
                            <span className="mt-0.5 block text-xs text-secondary-500">
                              {useLabel(stock, places)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <CheckButton
                            stock={stock}
                            onPick={(kind) => setAction({ kind, item, stock })}
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-secondary-400">—</td>
                        <td className="px-3 py-2.5" colSpan={2}>
                          <LocationButton
                            label="Say where it's kept"
                            onClick={() => setAction({ kind: "add", item })}
                          />
                        </td>
                        <td />
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-4 py-6 text-sm text-secondary-500">Nothing matches.</p>
            )}
          </div>

          {rows.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE_ROWS)}
              className="text-sm font-semibold text-primary-600 hover:underline"
            >
              Show {Math.min(PAGE_ROWS, rows.length - shown)} more
            </button>
          )}
        </>
      )}
      <StockActionDialog action={action} onClose={() => setAction(null)} />
    </Page>
  );
}
