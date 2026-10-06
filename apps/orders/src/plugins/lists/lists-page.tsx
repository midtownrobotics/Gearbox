import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { formatCents } from "../../shared/format";
import { Button, Card, ErrorBanner, Field, Loading, Page, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { ProgressBar, summary } from "./progress";
import { listSearch } from "./search";

/** Every list with how far along its parts are; anyone can start a new one here. */
export function ListsPage() {
  const { data, error } = useLoad(async () => {
    const res = await api.lists.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const find = useMemo(() => listSearch(data ?? []), [data]);
  const shown = find(query).filter((l) => showArchived || !l.isArchived);
  const archivedCount = (data ?? []).filter((l) => l.isArchived).length;

  return (
    <Page
      title="Lists"
      actions={!creating && <Button onClick={() => setCreating(true)}>New list</Button>}
    >
      {creating && <NewListForm onCancel={() => setCreating(false)} />}
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${inputClass} sm:max-w-sm`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a list…"
          aria-label="Find a list"
          type="search"
        />
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived ({archivedCount})
          </label>
        )}
      </div>
      {error && <ErrorBanner message={error} />}
      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className="text-sm text-secondary-500">
          {data.length === 0 ? "No lists yet." : "No lists match."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((l) => (
            <Link key={l.id} to={`/lists/${l.id}`} className="block group">
              <Card className="h-full space-y-3 group-hover:border-secondary-400 transition-colors">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-secondary-900 group-hover:text-primary-500">
                      {l.name}
                    </h2>
                    {l.isArchived && (
                      <span className="rounded-full border border-secondary-300 px-2 py-0.5 text-xs text-secondary-500">
                        Archived
                      </span>
                    )}
                  </div>
                  {l.description && (
                    <p className="text-sm text-secondary-600 line-clamp-2">{l.description}</p>
                  )}
                </div>
                <ProgressBar progress={l.progress} />
                <p className="text-xs text-secondary-500">
                  {summary(l.progress)}
                  {l.progress.active > 0 && ` · ${formatCents(l.progress.costCents)}`}
                  {l.progress.unpriced > 0 && ` + ${l.progress.unpriced} unpriced`}
                </p>
                <p className="text-xs text-secondary-400">By {l.createdByName}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

function NewListForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api.lists.$post({
      json: { name, description: description.trim() || null },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    navigate(`/lists/${(await res.json()).id}`);
  }

  return (
    <form onSubmit={create}>
      <Card title="New list" className="space-y-3">
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Intake v2, Week 3 restock, …"
            maxLength={100}
            required
            // biome-ignore lint/a11y/noAutofocus: opened by pressing "New list"
            autoFocus
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
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create list"}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
