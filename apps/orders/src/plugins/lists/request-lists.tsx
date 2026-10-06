import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { Button, Card, ErrorBanner, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

/** On a request's page: the lists it's on, and adding it to another. */
export function RequestLists({ requestId }: { requestId: number }) {
  const param = { requestId: String(requestId) };
  const onLists = useLoad(async () => {
    const res = await api.lists["for-request"][":requestId"].$get({ param });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [requestId]);
  const all = useLoad(async () => {
    const res = await api.lists.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((l) => !l.isArchived);
  }, []);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const on = new Set((onLists.data ?? []).map((l) => l.id));
  const choices = (all.data ?? []).filter((l) => !on.has(l.id));

  async function add() {
    setBusy(true);
    setError(null);
    const res = await api.lists[":id"].items.$post({
      param: { id: picked },
      json: { requestIds: [requestId] },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    setPicked("");
    onLists.reload();
  }

  async function remove(listId: number) {
    setError(null);
    const res = await api.lists[":id"].items[":requestId"].$delete({
      param: { id: String(listId), requestId: String(requestId) },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    onLists.reload();
  }

  return (
    <Card title="Lists" className="space-y-3">
      {onLists.data && onLists.data.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {onLists.data.map((l) => (
            <li
              key={l.id}
              className="inline-flex items-center gap-2 rounded-full border border-secondary-300 bg-white pl-3 pr-1 py-0.5 text-sm"
            >
              <Link to={`/lists/${l.id}`} className="text-secondary-800 hover:text-primary-500">
                {l.name}
              </Link>
              <button
                type="button"
                onClick={() => remove(l.id)}
                className="rounded-full px-1.5 text-secondary-400 hover:text-primary-600"
                aria-label={`Remove from ${l.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-secondary-500">Not on any list.</p>
      )}
      {choices.length > 0 ? (
        <div className="flex gap-2">
          <select
            className={`${inputClass} sm:max-w-xs`}
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Add to a list"
          >
            <option value="">Add to a list…</option>
            {choices.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <Button onClick={add} disabled={busy || !picked}>
            Add
          </Button>
        </div>
      ) : null}
      {(error || onLists.error) && <ErrorBanner message={(error ?? onLists.error) as string} />}
    </Card>
  );
}
