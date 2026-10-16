import {
  Button,
  ConfirmButton,
  ErrorBanner,
  Loading,
  Page,
  ProgressBar,
  TextField,
  buttonClass,
  focusRing,
} from "@g3/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchIssues } from "../../shared/getters/issues";
import { fetchItems } from "../../shared/getters/items";
import { fetchList, fetchLists } from "../../shared/getters/lists";
import type { ChecklistIssue, ChecklistItem, ChecklistList } from "../../shared/getters/types";

const POLL_INTERVAL_MS = 5000;

const textButton = `block rounded text-xs font-semibold text-secondary-500 hover:text-secondary-900 ${focusRing}`;

function BackLink() {
  return (
    <Link to="/checklists" className="text-sm text-secondary-500 hover:text-primary-600">
      ← All checklists
    </Link>
  );
}

export function ChecklistRunnerPage() {
  const { id } = useParams<{ id: string }>();
  const { hash } = useLocation();

  const [list, setList] = useState<ChecklistList | null>(null);
  const [lists, setLists] = useState<ChecklistList[]>([]);
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
    // The page stays up when a link at the bottom opens another list, so start over.
    setLoading(true);
    setNotFound(false);
    setBanner(null);
    setAddingIssueForItemId(null);
    setConfirmDeleteIssueId(null);
    window.scrollTo(0, 0);
    // Every list, in the Checklists page's order, for the links to the ones before and after.
    fetchLists()
      .then(setLists)
      .catch(() => {});
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

  // An issue on the Checklists page opens its list at the item it's on.
  useEffect(() => {
    if (!loading && hash.startsWith("#item-")) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
    }
  }, [loading, hash]);

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
      <Page title="Checklists" width="narrow" actions={<BackLink />}>
        <Loading />
      </Page>
    );
  }

  if (notFound || !list) {
    return (
      <Page title="Checklists" width="narrow" actions={<BackLink />}>
        <p className="text-sm text-secondary-500">Checklist not found.</p>
      </Page>
    );
  }

  const checkableItems = items.filter((i) => i.type === "item");
  const doneCount = checkableItems.filter((i) => i.checked).length;
  const totalCount = checkableItems.length;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;
  const allDone = doneCount === totalCount && totalCount > 0;
  const anyChecked = checkableItems.some((i) => i.checked);

  const position = lists.findIndex((l) => l.id === list.id);
  const previous = position > 0 ? lists[position - 1] : null;
  const next = position >= 0 && position < lists.length - 1 ? lists[position + 1] : null;

  const issuesByItemId = issues.reduce<Record<number, ChecklistIssue[]>>((acc, issue) => {
    if (!acc[issue.itemId]) acc[issue.itemId] = [];
    acc[issue.itemId].push(issue);
    return acc;
  }, {});

  return (
    <Page
      title={list.name}
      description={list.description ?? undefined}
      width="narrow"
      actions={<BackLink />}
    >
      {banner && <ErrorBanner message={banner} />}

      {totalCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className={allDone ? "font-semibold text-emerald-700" : "text-secondary-600"}>
              {allDone ? "All done!" : `${doneCount} of ${totalCount} complete`}
            </span>
            <span className="text-xs text-secondary-500">{Math.round(progress * 100)}%</span>
          </div>
          <ProgressBar percent={progress * 100} done={allDone} className="!h-2" />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-secondary-500">
          No items.{" "}
          <Link
            to={`/editor/${list.id}`}
            className="font-semibold text-primary-600 hover:underline"
          >
            Add some on Edit Checklists.
          </Link>
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            if (item.type === "topic") {
              return (
                <div key={item.id} className="pb-1 pt-3 first:pt-0">
                  <p className="border-b border-secondary-200 pb-2 text-xs font-bold uppercase tracking-widest text-secondary-500">
                    {item.name}
                  </p>
                </div>
              );
            }

            const isChecked = item.checked;
            const itemIssues = issuesByItemId[item.id] ?? [];
            const addingIssue = addingIssueForItemId === item.id;
            const hasIssueSection = itemIssues.length > 0 || addingIssue;

            return (
              <div
                key={item.id}
                id={`item-${item.id}`}
                className="rounded-xl border border-secondary-200 bg-surface"
              >
                {/* Checkbox row */}
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  className={`flex w-full items-start gap-4 rounded-xl p-4 text-left ${focusRing} ${
                    isChecked ? "opacity-60" : "hover:bg-secondary-50"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                      isChecked ? "border-primary-500 bg-primary-500" : "border-secondary-400"
                    }`}
                  >
                    {isChecked && (
                      <svg
                        viewBox="0 0 12 10"
                        className="h-3 w-3.5 fill-none stroke-on-primary stroke-2"
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
                      className={`text-base font-medium ${isChecked ? "text-secondary-500 line-through" : "text-secondary-900"}`}
                    >
                      {item.name}
                    </p>
                    {item.description && (
                      <p className="mt-0.5 text-sm text-secondary-500">{item.description}</p>
                    )}
                  </div>
                </button>

                {/* Issues, and the way to add one */}
                <div
                  className={
                    hasIssueSection
                      ? "space-y-2 border-t border-secondary-200 px-4 pb-3 pt-2"
                      : "px-4 pb-2"
                  }
                >
                  {itemIssues.map((issue) =>
                    confirmDeleteIssueId === issue.id ? (
                      <div key={issue.id} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-secondary-600">
                          Resolve "{issue.text}"?
                        </span>
                        <Button size="sm" onClick={() => deleteIssue(issue)}>
                          Resolve
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmDeleteIssueId(null)}
                        >
                          Keep it open
                        </Button>
                      </div>
                    ) : (
                      <div key={issue.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteIssueId(issue.id)}
                          className={`mt-0.5 h-5 w-5 shrink-0 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 ${focusRing}`}
                          title="Mark resolved"
                          aria-label={`Mark resolved: ${issue.text}`}
                        />
                        <p className="flex-1 text-sm leading-snug text-secondary-900">
                          {issue.text}
                        </p>
                      </div>
                    ),
                  )}

                  {addingIssue ? (
                    <div className="flex gap-2 pt-1">
                      <TextField
                        kind="issue"
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
                        className="min-w-0 flex-1"
                        autoFocus
                      />
                      <Button onClick={() => handleAddIssue(item.id)}>Add</Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAddingIssueForItemId(null);
                          setNewIssueText("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingIssueForItemId(item.id);
                        setNewIssueText("");
                      }}
                      className={textButton}
                    >
                      Add an issue
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {anyChecked && (
        <div className="flex flex-wrap gap-2 border-t border-secondary-200 pt-4">
          <ConfirmButton
            label="Reset this list"
            question="Uncheck every item on this list? Nothing is saved to Archives."
            confirmLabel="Uncheck every item"
            onConfirm={handleReset}
          />
        </div>
      )}

      {(previous || next) && (
        <nav
          aria-label="Other checklists"
          className="flex justify-between gap-2 border-t border-secondary-200 pt-4"
        >
          {previous && (
            <Link
              to={`/checklists/${previous.id}`}
              className={`${buttonClass()} min-w-0 max-w-[48%]`}
            >
              <span aria-hidden="true">←</span>
              <span className="truncate">{previous.name}</span>
            </Link>
          )}
          {next && (
            <Link
              to={`/checklists/${next.id}`}
              className={`${buttonClass()} ml-auto min-w-0 max-w-[48%]`}
            >
              <span className="truncate">{next.name}</span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </nav>
      )}
    </Page>
  );
}
