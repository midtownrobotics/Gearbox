import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { formatCents } from "../../shared/format";
import { STATUS, StatusBadge } from "../../shared/status-badge";
import type { OrderRequest, PartListDetail, RequestStatus } from "../../shared/types";
import { Button, Card, ErrorBanner, Field, Loading, Page, Stat, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { RequestList } from "../requests/requests-page";
import { ProgressBar, STAGES, StageCounts } from "./progress";
import { requestSearch } from "./search";

const FILTERS: (RequestStatus | "all")[] = [
  "all",
  "requested",
  "approved",
  "ordered",
  "received",
  "denied",
  "cancelled",
];

/** One list: how far along its parts are, fuzzy find over them, and adding more. */
export function ListDetailPage() {
  const { id = "" } = useParams();
  const user = useAuthUser();
  const { data, error, reload } = useLoad(async () => {
    const res = await api.lists[":id"].$get({ param: { id } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [id]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RequestStatus | "all">("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const find = useMemo(() => requestSearch(data?.requests ?? []), [data]);
  const onList = useMemo(() => new Set((data?.requests ?? []).map((r) => r.id)), [data]);

  if (error || !data) {
    return <Page title="List">{error ? <ErrorBanner message={error} /> : <Loading />}</Page>;
  }

  const list = data;
  const p = list.progress;
  const canManage = user.isMentor || list.createdById === user.userId;
  const matches = find(query);
  const shown = status === "all" ? matches : matches.filter((r) => r.status === status);
  const countIn = (s: RequestStatus | "all") =>
    s === "all" ? matches.length : matches.filter((r) => r.status === s).length;

  async function remove(r: OrderRequest) {
    setRemoveError(null);
    const res = await api.lists[":id"].items[":requestId"].$delete({
      param: { id, requestId: String(r.id) },
    });
    if (!res.ok) return setRemoveError(await getErrorMessage(res));
    reload();
  }

  return (
    <Page
      title={list.name}
      actions={
        <Link to="/lists" className="text-sm text-secondary-500 hover:text-secondary-800">
          ← All lists
        </Link>
      }
    >
      {list.isArchived && (
        <p className="text-sm text-secondary-600 bg-secondary-100 border border-secondary-200 rounded-lg px-4 py-2.5">
          Archived.
        </p>
      )}
      <Card className="space-y-4">
        {list.description && <p className="text-secondary-700">{list.description}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Stat
            label="Parts"
            value={p.active}
            hint={p.total > p.active ? `+ ${p.total - p.active} denied or cancelled` : undefined}
          />
          {STAGES.map((s) => (
            <Stat
              key={s.status}
              label={s.label}
              value={
                <span className="tabular-nums">
                  {p[s.status]}
                  {p.active > 0 && (
                    <span className="text-sm font-normal text-secondary-400">
                      {" "}
                      {Math.round((p[s.status] / p.active) * 100)}%
                    </span>
                  )}
                </span>
              }
            />
          ))}
        </div>
        <ProgressBar progress={p} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StageCounts progress={p} />
          <p className="text-sm text-secondary-600">
            {formatCents(p.costCents)}
            {p.unpriced > 0 && ` + ${p.unpriced} unpriced`}
          </p>
        </div>
        <p className="text-xs text-secondary-400">
          Made by {list.createdByName}
          {canManage && !editing && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="underline hover:text-secondary-700"
              >
                Edit list
              </button>
            </>
          )}
        </p>
        {editing && (
          <ListSettings
            list={list}
            onDone={() => {
              setEditing(false);
              reload();
            }}
          />
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/new?list=${list.id}`}
          className="rounded-lg bg-primary-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-600"
        >
          Request a new part
        </Link>
        <Link
          to={`/catalog?list=${list.id}`}
          className="rounded-lg border border-secondary-300 bg-white px-3.5 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-50"
        >
          Pick from catalog
        </Link>
        <Button variant="secondary" onClick={() => setAdding(!adding)}>
          {adding ? "Done adding" : "Add existing requests"}
        </Button>
      </div>
      {adding && <AddExisting listId={list.id} onList={onList} onAdded={reload} />}

      <div className="space-y-3">
        <input
          className={inputClass}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this list…"
          aria-label="Find on this list"
          type="search"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${
                status === f
                  ? "bg-secondary-900 text-white border-secondary-900"
                  : "bg-white text-secondary-600 border-secondary-300 hover:border-secondary-500"
              }`}
            >
              {f === "all" ? "All" : STATUS[f].label}{" "}
              <span className="tabular-nums opacity-70">{countIn(f)}</span>
            </button>
          ))}
        </div>
      </div>
      {removeError && <ErrorBanner message={removeError} />}
      <RequestList
        requests={shown}
        onChanged={reload}
        empty={list.requests.length === 0 ? "No parts yet." : "No matches."}
        extra={(r) => (
          <button
            type="button"
            onClick={() => remove(r)}
            className="text-xs text-secondary-400 hover:text-primary-600"
          >
            Remove from list
          </button>
        )}
      />
    </Page>
  );
}

/** Find requests that already exist and put them on the list. */
function AddExisting({
  listId,
  onList,
  onAdded,
}: { listId: number; onList: Set<number>; onAdded: () => void }) {
  const { data, error } = useLoad(async () => {
    const res = await api.requests.$get({ query: {} });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const available = useMemo(() => (data ?? []).filter((r) => !onList.has(r.id)), [data, onList]);
  const find = useMemo(() => requestSearch(available), [available]);
  const shown = find(query).slice(0, 50);

  const toggle = (id: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function add() {
    setBusy(true);
    setAddError(null);
    const res = await api.lists[":id"].items.$post({
      param: { id: String(listId) },
      json: { requestIds: [...picked] },
    });
    setBusy(false);
    if (!res.ok) return setAddError(await getErrorMessage(res));
    setPicked(new Set());
    onAdded();
  }

  return (
    <Card title="Add existing requests" className="space-y-3">
      <input
        className={inputClass}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search every request…"
        aria-label="Search requests to add"
        type="search"
        // biome-ignore lint/a11y/noAutofocus: opened by pressing "Add existing requests"
        autoFocus
      />
      {error && <ErrorBanner message={error} />}
      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className="text-sm text-secondary-500">
          {available.length === 0 ? "Every request is already on this list." : "No matches."}
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-secondary-100 rounded-lg border border-secondary-200">
          {shown.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-secondary-50 cursor-pointer">
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-secondary-900">
                    {r.quantity}× {r.title}
                  </span>
                  <span className="block text-xs text-secondary-500">
                    {r.vendor} · {r.requesterName} · #{r.id}
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {addError && <ErrorBanner message={addError} />}
      <Button onClick={add} disabled={busy || picked.size === 0}>
        {busy ? "Adding…" : `Add ${picked.size || ""} to list`}
      </Button>
    </Card>
  );
}

/** Rename, describe, archive or delete a list (its creator or a mentor). */
function ListSettings({ list, onDone }: { list: PartListDetail; onDone: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const param = { id: String(list.id) };

  async function save(patch: { name?: string; description?: string | null; isArchived?: boolean }) {
    setBusy(true);
    setError(null);
    const res = await api.lists[":id"].$patch({ param, json: patch });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone();
  }

  async function remove() {
    if (!window.confirm(`Delete "${list.name}"? Its requests aren't deleted.`)) return;
    setBusy(true);
    const res = await api.lists[":id"].$delete({ param });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    navigate("/lists");
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save({ name, description: description.trim() || null });
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-secondary-100 pt-4">
      <Field label="Name">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </Field>
      <Field label="Description">
        <input
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
        />
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          Save
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <span className="flex-1" />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => save({ isArchived: !list.isArchived })}
        >
          {list.isArchived ? "Unarchive" : "Archive"}
        </Button>
        <Button variant="danger" disabled={busy} onClick={remove}>
          Delete list
        </Button>
      </div>
    </form>
  );
}
