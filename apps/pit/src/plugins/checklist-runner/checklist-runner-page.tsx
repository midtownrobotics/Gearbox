import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchIssues } from "../../shared/getters/issues";
import { fetchItems } from "../../shared/getters/items";
import { fetchList } from "../../shared/getters/lists";
import type { ChecklistIssue, ChecklistItem, ChecklistList } from "../../shared/getters/types";

const POLL_INTERVAL_MS = 5000;

export function ChecklistRunnerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [list, setList] = useState<ChecklistList | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [issues, setIssues] = useState<ChecklistIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const [addingIssueForItemId, setAddingIssueForItemId] = useState<number | null>(null);
  const [newIssueText, setNewIssueText] = useState("");
  const [confirmDeleteIssueId, setConfirmDeleteIssueId] = useState<number | null>(null);

  const pendingToggles = useRef<Set<number>>(new Set());

  const loadData = useCallback(async () => {
    if (!id) return;
    const [itemsData, issuesData] = await Promise.all([fetchItems(id), fetchIssues(id)]);
    setItems((prev) => {
      const sorted = itemsData.sort((a, b) => a.index - b.index);
      if (pendingToggles.current.size === 0) return sorted;
      return sorted.map((item) => {
        const local = prev.find((p) => p.id === item.id);
        return local && pendingToggles.current.has(item.id) ? local : item;
      });
    });
    setIssues(issuesData);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchList(id), fetchItems(id), fetchIssues(id)])
      .then(([listData, itemsData, issuesData]) => {
        if (!listData) {
          setNotFound(true);
          return;
        }
        setList(listData);
        setItems(itemsData.sort((a, b) => a.index - b.index));
        setIssues(issuesData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id || loading || notFound) return;
    let requestInFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      try {
        await loadData();
      } finally {
        requestInFlight = false;
      }
    };
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, loading, notFound, loadData]);

  async function toggle(item: ChecklistItem) {
    const next = !item.checked;
    pendingToggles.current.add(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));

    const res = await api.lists[":id"].items[":itemId"].checked.$patch({
      param: { id: String(item.listId), itemId: String(item.id) },
      json: { checked: next },
    });
    pendingToggles.current.delete(item.id);

    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i)));
    }
  }

  async function handleReset() {
    if (!list) return;
    setItems((prev) => prev.map((i) => ({ ...i, checked: false })));
    const res = await api.lists[":id"].reset.$post({ param: { id: String(list.id) } });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      await loadData();
    }
  }

  async function handleAddIssue(itemId: number) {
    if (!list || !newIssueText.trim()) return;
    const res = await api.lists[":id"].items[":itemId"].issues.$post({
      param: { id: String(list.id), itemId: String(itemId) },
      json: { text: newIssueText.trim() },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setAddingIssueForItemId(null);
    setNewIssueText("");
    await loadData();
  }

  async function deleteIssue(issue: ChecklistIssue) {
    if (!list) return;
    setIssues((prev) => prev.filter((i) => i.id !== issue.id));

    const res = await api.lists[":id"].items[":itemId"].issues[":issueId"].$delete({
      param: {
        id: String(list.id),
        itemId: String(issue.itemId),
        issueId: String(issue.id),
      },
    });

    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      await loadData();
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  if (notFound || !list) {
    return (
      <main className="min-h-screen bg-page flex flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Checklist not found.</p>
        <button
          type="button"
          onClick={() => navigate("/checklists")}
          className="text-primary-600 hover:text-primary-700 text-sm underline"
        >
          Back
        </button>
      </main>
    );
  }

  const checkableItems = items.filter((i) => i.type === "item");
  const doneCount = checkableItems.filter((i) => i.checked).length;
  const totalCount = checkableItems.length;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;
  const allDone = doneCount === totalCount && totalCount > 0;
  const anyChecked = checkableItems.some((i) => i.checked);

  const issuesByItemId = issues.reduce<Record<number, ChecklistIssue[]>>((acc, issue) => {
    if (!acc[issue.itemId]) acc[issue.itemId] = [];
    acc[issue.itemId].push(issue);
    return acc;
  }, {});

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate("/checklists")}
            className="text-sm text-gray-600 hover:text-gray-700 transition-colors"
          >
            ← Back
          </button>
          {anyChecked && (
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-gray-600 hover:text-red-400 transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        {banner && (
          <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-2">
            {banner}
          </p>
        )}

        <div>
          <h1 className="text-3xl font-bold tracking-tight">{list.name}</h1>
          {list.description && <p className="text-sm text-gray-600 mt-1">{list.description}</p>}
        </div>

        {totalCount > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className={allDone ? "text-green-400 font-semibold" : "text-gray-600"}>
                {allDone ? "All done!" : `${doneCount} of ${totalCount} complete`}
              </span>
              <span className="text-gray-600 text-xs">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${allDone ? "bg-green-500" : "bg-red-500"}`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">
            No items.{" "}
            <button
              type="button"
              onClick={() => navigate(`/editor/${list.id}`)}
              className="text-primary-600 hover:text-primary-700 underline"
            >
              Add some in the Editor.
            </button>
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              if (item.type === "topic") {
                return (
                  <div key={item.id} className="pt-3 pb-1 first:pt-0">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-600 border-b border-gray-200 pb-2">
                      {item.name}
                    </p>
                  </div>
                );
              }

              const isChecked = item.checked;
              const itemIssues = issuesByItemId[item.id] ?? [];

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border transition-all ${
                    isChecked ? "border-gray-200" : "border-gray-300"
                  }`}
                >
                  {/* Checkbox row */}
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    className={`w-full flex items-start gap-4 p-4 text-left rounded-xl transition-colors ${
                      isChecked ? "bg-surface opacity-60" : "bg-surface hover:bg-gray-100"
                    }`}
                  >
                    <div
                      className={`mt-0.5 w-6 h-6 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors ${
                        isChecked ? "bg-primary-600 border-primary-600" : "border-gray-600"
                      }`}
                    >
                      {isChecked && (
                        <svg
                          viewBox="0 0 12 10"
                          className="w-3.5 h-3 fill-none stroke-white stroke-2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="1,5 4,8 11,1" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p
                        className={`text-base font-medium transition-colors ${isChecked ? "line-through text-gray-600" : "text-gray-900"}`}
                      >
                        {item.name}
                      </p>
                      {item.description && (
                        <p
                          className={`text-sm mt-0.5 ${isChecked ? "text-gray-600" : "text-gray-600"}`}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Issues section */}
                  {(itemIssues.length > 0 || addingIssueForItemId === item.id) && (
                    <div className="px-4 pb-3 space-y-1.5 border-t border-gray-200 pt-2">
                      {itemIssues.map((issue) => (
                        <div key={issue.id}>
                          {confirmDeleteIssueId === issue.id ? (
                            <div className="flex items-center gap-3 py-0.5">
                              <span className="text-xs text-gray-600 flex-1 truncate">
                                Delete "{issue.text}"?
                              </span>
                              <button
                                type="button"
                                onClick={() => deleteIssue(issue)}
                                className="px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteIssueId(null)}
                                className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 group/issue">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteIssueId(issue.id)}
                                className="mt-0.5 w-4 h-4 rounded border border-gray-400 hover:bg-gray-300 shrink-0 transition-colors"
                                title="Mark resolved"
                              />
                              <p className="text-sm flex-1 leading-snug text-gray-900">
                                {issue.text}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}

                      {addingIssueForItemId === item.id ? (
                        <div className="flex gap-2 pt-1">
                          <input
                            type="text"
                            placeholder="Describe the issue…"
                            value={newIssueText}
                            onChange={(e) => setNewIssueText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddIssue(item.id);
                              if (e.key === "Escape") {
                                setAddingIssueForItemId(null);
                                setNewIssueText("");
                              }
                            }}
                            className="flex-1 bg-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:border-yellow-300"
                            // biome-ignore lint/a11y/noAutofocus: intentional — user just opened the issue form
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleAddIssue(item.id)}
                            className="px-3 py-1.5 bg-yellow-100 hover:bg-yellow-100 text-gray-900 text-xs font-semibold rounded-lg"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingIssueForItemId(null);
                              setNewIssueText("");
                            }}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setAddingIssueForItemId(item.id);
                            setNewIssueText("");
                          }}
                          className="text-xs text-gray-600 hover:text-gray-900 transition-colors pt-0.5"
                        >
                          + Add issue
                        </button>
                      )}
                    </div>
                  )}

                  {/* Add issue trigger when no issues exist yet */}
                  {itemIssues.length === 0 && addingIssueForItemId !== item.id && (
                    <div className="px-4 pb-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingIssueForItemId(item.id);
                          setNewIssueText("");
                        }}
                        className="text-xs text-gray-700 hover:text-gray-900 transition-colors"
                      >
                        + Add issue
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
