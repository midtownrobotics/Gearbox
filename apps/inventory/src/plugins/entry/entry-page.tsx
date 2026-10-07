import { appUrl } from "@g3/site-config";
import type { ItemView } from "@g3/worker-inventory";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { type Draft, FieldInputs, ValueView, draftOf, valuesOf } from "../../shared/field-inputs";
import { count, formatDate, formatDateTime } from "../../shared/format";
import { useInventory } from "../../shared/inventory-data";
import { locationLabel, useLabel } from "../../shared/places";
import {
  CheckButton,
  LocationButton,
  QuantityCell,
  type StockAction,
  StockActionDialog,
} from "../../shared/stock-cells";
import {
  Button,
  Card,
  Dialog,
  ErrorBanner,
  Field,
  Loading,
  Page,
  StatusBadge,
  inputClass,
} from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { ListingsCard } from "./listings-card";

const EVENT_LABELS: Record<string, string> = {
  created: "Added to the inventory",
  edited: "Edited",
  added: "Parts added",
  counted: "Counted",
  moved: "Moved",
  checked_out: "Checked out",
  checked_in: "Checked in",
  received: "Received from an order",
  linked: "Listing added",
  unlinked: "Listing removed",
  merged: "Merged",
  split: "Split",
};

type Event = {
  id: number;
  action: string;
  note: string | null;
  ref: string | null;
  userName: string;
  createdAt: number;
};

/** Where a history line points: the Orders request parts came from, or another entry. */
function RefLink({ refText }: { refText: string | null }) {
  const { items } = useInventory();
  const request = refText?.match(/^orders:request:(\d+)$/);
  if (request) {
    return (
      <a
        href={`${appUrl("orders")}/requests/${request[1]}`}
        className="text-xs text-primary-600 hover:underline"
      >
        See the order request ↗
      </a>
    );
  }
  const entry = refText?.match(/^item:(\d+)$/);
  const other = entry && items.find((item) => item.id === Number(entry[1]));
  if (other) {
    return (
      <Link to={`/items/${other.id}`} className="text-xs text-primary-600 hover:underline">
        Open “{other.name}”
      </Link>
    );
  }
  return null;
}

function HistoryCard({ events }: { events: Event[] }) {
  return (
    <Card title="History">
      <ol className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="w-32 shrink-0 whitespace-nowrap tabular-nums text-secondary-400">
              {formatDateTime(e.createdAt)}
            </span>
            <div>
              <p className="text-secondary-900">
                <span className="font-semibold">{EVENT_LABELS[e.action] ?? e.action}</span> by{" "}
                {e.userName}
              </p>
              {e.note && <p className="whitespace-pre-wrap text-secondary-600">{e.note}</p>}
              <RefLink refText={e.ref} />
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** The entry's name and the team's fields, shown or (with Edit) changed. */
function DetailsCard({ item, onChanged }: { item: ItemView; onChanged: () => Promise<void> }) {
  const { fields } = useInventory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setName(item.name);
    setDraft(draftOf(fields, item.values));
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = valuesOf(fields, draft);
    if ("error" in parsed) return setError(parsed.error);
    setBusy(true);
    setError(null);
    const res = await api.items[":id"].$patch({
      param: { id: String(item.id) },
      json: { name: name.trim(), values: parsed.values },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    await onChanged();
    setEditing(false);
  }

  if (editing) {
    return (
      <Card title="Details">
        <form onSubmit={save} className="space-y-4">
          <Field label="Name">
            <input
              className={inputClass}
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <FieldInputs fields={fields} draft={draft} onChange={setDraft} />
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    );
  }
  return (
    <Card title="Details">
      {fields.length === 0 ? (
        <p className="text-sm text-secondary-500">
          No fields have been set up yet. An admin defines them on Settings.
        </p>
      ) : (
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
          {fields.map((field) => (
            <div key={field.id} className="contents">
              <dt className="text-secondary-500">{field.name}</dt>
              <dd className="text-secondary-900">
                <ValueView field={field} value={item.values[field.id]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" onClick={start}>
          Edit
        </Button>
        <span className="text-xs text-secondary-400">
          Added by {item.createdByName} on {formatDate(item.createdAt)}
        </span>
      </div>
    </Card>
  );
}

/** Where the entry's parts are: the same rows as the main table, with the same actions. */
function StockCard({ item, onChanged }: { item: ItemView; onChanged: () => Promise<void> }) {
  const { places } = useInventory();
  const [action, setAction] = useState<StockAction | null>(null);
  const total = item.stock.reduce((sum, row) => sum + row.quantity, 0);
  const inUse = item.stock
    .filter((row) => row.status === "in_use")
    .reduce((sum, row) => sum + row.quantity, 0);

  return (
    <Card title="Where it is">
      {item.stock.length === 0 ? (
        <p className="text-sm text-secondary-500">Not counted yet, and not kept anywhere yet.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-secondary-700">
            <span className="font-semibold text-secondary-900">{total}</span> in all
            {inUse > 0 && `: ${total - inUse} in storage, ${inUse} in use`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-secondary-200 text-xs font-bold uppercase tracking-wider text-secondary-400">
                  <th className="py-2 pr-3">Qty</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last counted</th>
                  <th className="py-2 pl-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {item.stock.map((stock) => (
                  <tr key={stock.id} className="align-top">
                    <td className="py-1.5 pr-3">
                      <QuantityCell stock={stock} onSaved={() => void onChanged()} />
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
                    <td className="px-3 py-2.5 text-secondary-500">
                      {stock.countedAt === null
                        ? "—"
                        : `${formatDate(stock.countedAt)} by ${stock.countedByName}`}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <CheckButton
                        stock={stock}
                        onPick={(kind) => setAction({ kind, item, stock })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="mt-4">
        <Button variant="secondary" onClick={() => setAction({ kind: "add", item })}>
          Add parts
        </Button>
      </div>
      <StockActionDialog
        action={action}
        onClose={() => setAction(null)}
        onDone={() => void onChanged()}
      />
    </Card>
  );
}

/** Combines another entry into this one. */
function MergeDialog({
  item,
  onClose,
  onChanged,
}: { item: ItemView; onClose: () => void; onChanged: () => Promise<void> }) {
  const { items } = useInventory();
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState<ItemView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return items
      .filter((other) => {
        if (other.id === item.id) return false;
        const text = [
          other.name,
          ...other.listings.flatMap((listing) => [listing.vendor, listing.sku ?? ""]),
        ]
          .join(" ")
          .toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, 20);
  }, [items, item.id, query]);

  async function merge() {
    if (!from) return;
    setBusy(true);
    setError(null);
    const res = await api.items[":id"].merge.$post({
      param: { id: String(item.id) },
      json: { fromId: from.id },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    await onChanged();
    onClose();
  }

  return (
    <Dialog title="Merge another entry into this one" onClose={onClose}>
      <p className="text-sm text-secondary-600">
        For equivalent parts that are counted together, like the same bolt from two vendors.
      </p>
      {from ? (
        <>
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            “{from.name}” will be merged into “{item.name}”: its{" "}
            {count(
              from.stock.reduce((sum, row) => sum + row.quantity, 0),
              "part",
            )}
            , {count(from.listings.length, "listing")} and history move here, and it's removed. A
            listing can be split off again later.
          </p>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setFrom(null)}>
              Back
            </Button>
            <Button disabled={busy} onClick={() => void merge()}>
              {busy ? "Merging…" : "Merge"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <input
            type="search"
            className={inputClass}
            placeholder="Find the other entry by name, vendor or part number"
            aria-label="Find the entry to merge in"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && found.length === 0 && (
            <p className="text-sm text-secondary-500">No other entry matches.</p>
          )}
          {found.length > 0 && (
            <ul className="max-h-64 divide-y divide-secondary-100 overflow-y-auto rounded-lg border border-secondary-200">
              {found.map((other) => (
                <li key={other.id}>
                  <button
                    type="button"
                    onClick={() => setFrom(other)}
                    className="block w-full px-3 py-2 text-left text-sm text-secondary-900 hover:bg-secondary-50"
                  >
                    {other.name}
                    <span className="block text-xs text-secondary-500">
                      {count(
                        other.stock.reduce((sum, row) => sum + row.quantity, 0),
                        "part",
                      )}
                      {other.listings.length > 0 &&
                        ` · ${other.listings
                          .map((l) => l.vendor)
                          .filter(Boolean)
                          .join(", ")}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}

function DeleteDialog({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const { reload } = useInventory();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await api.items[":id"].$delete({ param: { id: String(item.id) } });
    if (!res.ok) {
      setBusy(false);
      return setError(await getErrorMessage(res));
    }
    await reload();
    navigate("/inventory");
  }

  return (
    <Dialog title="Delete this entry?" onClose={onClose}>
      <p className="text-sm text-secondary-600">
        “{item.name}” is removed from the inventory, with its counts, listings and history. This
        can't be undone.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Dialog>
  );
}

/** One entry: its details, where its parts are, how it's bought, and everything done to it. */
export function EntryPage() {
  const { id } = useParams();
  const { reload } = useInventory();
  const { isMentor } = useAuthUser();
  const [dialog, setDialog] = useState<"merge" | "delete" | null>(null);
  const detail = useLoad(async () => {
    const res = await api.items[":id"].$get({ param: { id: id ?? "" } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [id]);

  const back = (
    <Link to="/inventory" className="text-sm text-secondary-500 hover:text-primary-600">
      ← All entries
    </Link>
  );
  if (detail.error) {
    return (
      <Page title="Entry" actions={back}>
        <ErrorBanner message={detail.error} />
      </Page>
    );
  }
  // Another entry's page is on screen until this one's has loaded.
  if (!detail.data || String(detail.data.item.id) !== id) {
    return (
      <Page title="Entry" actions={back}>
        <Loading />
      </Page>
    );
  }
  const { item, events } = detail.data;
  /** After a change made here: this page's data, and the shared table's. */
  const changed = async () => {
    detail.reload();
    await reload();
  };

  return (
    <Page title={item.name} actions={back}>
      <DetailsCard item={item} onChanged={changed} />
      <StockCard item={item} onChanged={changed} />
      <ListingsCard item={item} onChanged={changed} />
      <HistoryCard events={events} />
      {isMentor && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog("merge")}>
            Merge another entry into this one…
          </Button>
          <Button variant="danger" onClick={() => setDialog("delete")}>
            Delete entry…
          </Button>
        </div>
      )}
      {dialog === "merge" && (
        <MergeDialog item={item} onClose={() => setDialog(null)} onChanged={changed} />
      )}
      {dialog === "delete" && <DeleteDialog item={item} onClose={() => setDialog(null)} />}
    </Page>
  );
}
