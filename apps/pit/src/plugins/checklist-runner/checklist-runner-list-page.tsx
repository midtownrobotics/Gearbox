import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchAllIssues } from "../../shared/getters/issues";
import { fetchLists } from "../../shared/getters/lists";
import type { ChecklistIssueSummary, ChecklistList } from "../../shared/getters/types";

const POLL_INTERVAL_MS = 5000;

export function ChecklistRunnerListPage() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ChecklistList[]>([]);
  const [issues, setIssues] = useState<ChecklistIssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteIssueId, setConfirmDeleteIssueId] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchLists(), fetchAllIssues()])
      .then(([listsData, issuesData]) => {
        setLists(listsData);
        setIssues(issuesData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    let requestInFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      try {
        const [listsData, issuesData] = await Promise.all([fetchLists(), fetchAllIssues()]);
        setLists(listsData);
        setIssues(issuesData);
      } catch {
        // Keep the last successful data visible while a refresh fails.
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
  }, [loading]);

  async function handleDeleteIssue(issue: ChecklistIssueSummary) {
    setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    setConfirmDeleteIssueId(null);
    const res = await api.lists[":id"].items[":itemId"].issues[":issueId"].$delete({
      param: {
        id: String(issue.listId),
        itemId: String(issue.itemId),
        issueId: String(issue.id),
      },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      fetchAllIssues()
        .then(setIssues)
        .catch(() => {});
    }
  }

  async function handleGlobalReset() {
    const res = await api.reset.$post({});
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setConfirmReset(false);
      return;
    }
    setConfirmReset(false);
    setBanner(null);
    Promise.all([fetchLists(), fetchAllIssues()])
      .then(([listsData, issuesData]) => {
        setLists(listsData);
        setIssues(issuesData);
      })
      .catch(() => {});
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  const totalItems = lists.reduce((sum, l) => sum + l.itemCount, 0);
  const totalChecked = lists.reduce((sum, l) => sum + l.checkedCount, 0);
  const globalProgress = totalItems > 0 ? totalChecked / totalItems : 0;
  const allDone = totalChecked === totalItems && totalItems > 0;

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Checklists</h1>
          {lists.length > 0 && !confirmReset && (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="text-sm text-gray-600 hover:text-red-400 transition-colors"
            >
              Reset All
            </button>
          )}
          {confirmReset && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">Reset all checklists?</span>
              <button
                type="button"
                onClick={handleGlobalReset}
                className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {banner && (
          <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-2">
            {banner}
          </p>
        )}

        {totalItems > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className={allDone ? "text-green-400 font-semibold" : "text-gray-600"}>
                {allDone ? "All done!" : `${totalChecked} of ${totalItems} items complete`}
              </span>
              <span className="text-gray-600 text-xs">{Math.round(globalProgress * 100)}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${allDone ? "bg-green-500" : "bg-red-500"}`}
                style={{ width: `${globalProgress * 100}%` }}
              />
            </div>
          </div>
        )}

        {lists.length === 0 ? (
          <p className="text-gray-600 text-center py-12">
            No checklists yet.{" "}
            <button
              type="button"
              onClick={() => navigate("/editor")}
              className="text-red-400 hover:text-red-300 underline"
            >
              Create one in the Editor.
            </button>
          </p>
        ) : (
          <div className="space-y-3">
            {lists.map((list) => {
              const listProgress = list.itemCount > 0 ? list.checkedCount / list.itemCount : 0;
              const listDone = list.checkedCount === list.itemCount && list.itemCount > 0;

              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => navigate(`/checklists/${list.id}`)}
                  className="w-full bg-white hover:bg-gray-100 border border-gray-300 hover:border-gray-600 rounded-xl p-5 text-left transition-colors group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold text-gray-900 group-hover:text-red-400 transition-colors truncate">
                        {list.name}
                      </p>
                      {list.description && (
                        <p className="text-sm text-gray-600 mt-0.5 truncate">{list.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 ${listDone ? "bg-green-900 text-green-400" : "bg-gray-100 text-gray-600"}`}
                      >
                        {list.checkedCount}/{list.itemCount}
                      </span>
                      <span className="text-gray-600 group-hover:text-red-400 transition-colors">
                        →
                      </span>
                    </div>
                  </div>

                  {list.itemCount > 0 && (
                    <div className="mt-3 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${listDone ? "bg-green-500" : "bg-red-500"}`}
                        style={{ width: `${listProgress * 100}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Issues */}
        {issues.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-gray-200">
            <div className="text-lg font-semibold text-secondary-900">
              Issues{" "}
              <span className="text-sm font-normal text-secondary-900">{issues.length} open</span>
            </div>

            <div className="space-y-2">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="bg-white border border-yellow-300 rounded-xl px-4 py-3"
                >
                  {confirmDeleteIssueId === issue.id ? (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 flex-1 truncate">
                        Delete this issue?
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteIssue(issue)}
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
                    <div className="flex items-start gap-3 group/issue">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900">{issue.text}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {issue.listName} · {issue.itemName}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteIssueId(issue.id)}
                        className="opacity-0 group-hover/issue:opacity-100 p-0.5 text-gray-600 hover:text-red-400 transition-all shrink-0 mt-0.5"
                        title="Delete issue"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
