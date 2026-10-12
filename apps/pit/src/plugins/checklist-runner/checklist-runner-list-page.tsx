import { Badge, Button, ErrorBanner, Loading, Page, ProgressBar, focusRing, tones } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { archiveTitle, fetchArchiveDefaults } from "../../shared/getters/archives";
import { fetchAllIssues } from "../../shared/getters/issues";
import { fetchLists } from "../../shared/getters/lists";
import type {
  ArchiveDefaults,
  ChecklistArchive,
  ChecklistIssueSummary,
  ChecklistList,
} from "../../shared/getters/types";
import { ArchiveDialog } from "./archive-dialog";

const POLL_INTERVAL_MS = 5000;

export function ChecklistRunnerListPage() {
  const { hash } = useLocation();
  const [lists, setLists] = useState<ChecklistList[]>([]);
  const [issues, setIssues] = useState<ChecklistIssueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [archiveDefaults, setArchiveDefaults] = useState<ArchiveDefaults | null>(null);
  const [archived, setArchived] = useState<ChecklistArchive | null>(null);
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
    // The team's event, so the Archive pop-up opens knowing it.
    fetchArchiveDefaults()
      .then(setArchiveDefaults)
      .catch(() => {});
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

  // The Overview's Open issues tile opens the page at its issues.
  useEffect(() => {
    if (!loading && hash === "#issues") document.getElementById("issues")?.scrollIntoView();
  }, [loading, hash]);

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

  function handleArchived(archive: ChecklistArchive) {
    setArchiving(false);
    setArchived(archive);
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
      <Page title="Checklists" width="narrow">
        <Loading />
      </Page>
    );
  }

  const totalItems = lists.reduce((sum, l) => sum + l.itemCount, 0);
  const totalChecked = lists.reduce((sum, l) => sum + l.checkedCount, 0);
  const globalProgress = totalItems > 0 ? totalChecked / totalItems : 0;
  const allDone = totalChecked === totalItems && totalItems > 0;

  return (
    <Page
      title="Checklists"
      width="narrow"
      actions={
        lists.length > 0 && (
          <Button
            size="lg"
            onClick={() => {
              setArchived(null);
              setArchiving(true);
            }}
          >
            Archive and reset
          </Button>
        )
      }
    >
      {banner && <ErrorBanner message={banner} />}

      {archived && (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"
        >
          <span>Archived: {archiveTitle(archived)}</span>
          <Link to="/logs" className="font-semibold underline">
            View in Logs
          </Link>
        </p>
      )}

      {totalItems > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className={allDone ? "font-semibold text-emerald-700" : "text-secondary-600"}>
              {allDone ? "All done!" : `${totalChecked} of ${totalItems} items complete`}
            </span>
            <span className="text-xs text-secondary-500">{Math.round(globalProgress * 100)}%</span>
          </div>
          <ProgressBar percent={globalProgress * 100} done={allDone} className="!h-2" />
        </div>
      )}

      {lists.length === 0 ? (
        <p className="text-sm text-secondary-500">
          No checklists yet.{" "}
          <Link to="/editor" className="font-semibold text-primary-600 hover:underline">
            Create one on Edit Checklists.
          </Link>
        </p>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => {
            const listProgress = list.itemCount > 0 ? list.checkedCount / list.itemCount : 0;
            const listDone = list.checkedCount === list.itemCount && list.itemCount > 0;

            return (
              <Link
                key={list.id}
                to={`/checklists/${list.id}`}
                className={`group block rounded-xl border border-secondary-200 bg-surface p-5 hover:border-secondary-400 ${focusRing}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-secondary-900 group-hover:text-primary-600">
                      {list.name}
                    </p>
                    {list.description && (
                      <p className="mt-0.5 truncate text-sm text-secondary-500">
                        {list.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge colors={listDone ? tones.success : tones.neutral}>
                      {list.checkedCount}/{list.itemCount}
                    </Badge>
                    <span className="text-secondary-400 group-hover:text-primary-600">→</span>
                  </div>
                </div>

                {list.itemCount > 0 && (
                  <ProgressBar percent={listProgress * 100} done={listDone} className="mt-3" />
                )}
              </Link>
            );
          })}
        </div>
      )}

      {issues.length > 0 && (
        <section id="issues" className="scroll-mt-4 space-y-2 border-t border-secondary-200 pt-4">
          <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
            Open issues · {issues.length}
          </h2>

          {issues.map((issue) => (
            <div key={issue.id} className="rounded-xl border border-amber-300 bg-surface px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-secondary-900">{issue.text}</p>
                  <p className="mt-1 text-xs text-secondary-500">
                    {issue.listName} · {issue.itemName}
                  </p>
                </div>
                {confirmDeleteIssueId === issue.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-secondary-600">Resolve this issue?</span>
                    <Button size="sm" onClick={() => handleDeleteIssue(issue)}>
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmDeleteIssueId(issue.id)}
                  >
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {archiving && (
        <ArchiveDialog
          known={archiveDefaults}
          onClose={() => setArchiving(false)}
          onArchived={handleArchived}
        />
      )}
    </Page>
  );
}
