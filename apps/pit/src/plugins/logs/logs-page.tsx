import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { archiveTitle, fetchArchive, fetchArchives } from "../../shared/getters/archives";
import type {
  ArchivedIssue,
  ArchivedIssueStatus,
  ArchivedItem,
  ArchivedList,
  ChecklistArchive,
  ChecklistArchiveDetail,
} from "../../shared/getters/types";

// Logs: every archive of the checklists ("Archive and Reset" on the Checklists page), newest
// first. A panel opens to everything that was in the checklists then, in one list.

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// Fixed colors because they mean something: red for a new problem, amber for one still waiting,
// green for one that's done.
const STATUS: Record<ArchivedIssueStatus, { label: string; className: string; icon: string }> = {
  new: {
    label: "New",
    className: "bg-red-100 text-red-800",
    icon: "M12 8v5M12 16.5v.5",
  },
  open: {
    label: "Still Open",
    className: "bg-amber-100 text-amber-800",
    icon: "M12 7.5V12l3 2",
  },
  resolved: {
    label: "Resolved",
    className: "bg-green-100 text-green-800",
    icon: "M8 12.5l2.5 2.5L16 9.5",
  },
};

function StatusBadge({ status }: { status: ArchivedIssueStatus }) {
  const { label, className, icon } = STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-1 pr-2 text-xs font-semibold ${className}`}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d={icon} />
      </svg>
      {label}
    </span>
  );
}

/** A check box as it stood: filled with a check, or empty. `small` is an issue's. */
function CheckMark({ checked, small }: { checked: boolean; small?: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? "Checked" : "Not checked"}
      className={`flex shrink-0 items-center justify-center border-2 ${
        small ? "mt-0.5 h-4 w-4 rounded" : "h-5 w-5 rounded-md"
      } ${checked ? "border-primary-600 bg-primary-600" : "border-gray-400"}`}
    >
      {checked && (
        <svg
          viewBox="0 0 12 10"
          className={`fill-none stroke-white stroke-2 ${small ? "h-2 w-2.5" : "h-2.5 w-3"}`}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="1,5 4,8 11,1" />
        </svg>
      )}
    </span>
  );
}

function IssueRow({ issue }: { issue: ArchivedIssue }) {
  return (
    <li className="flex items-start gap-2">
      <CheckMark checked={issue.status === "resolved"} small />
      <span className="min-w-0 flex-1 text-sm leading-snug text-gray-700">{issue.text}</span>
      <StatusBadge status={issue.status} />
    </li>
  );
}

function ItemRow({ item }: { item: ArchivedItem }) {
  if (item.type === "topic") {
    return (
      <li className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-widest text-gray-600">
        {item.name}
      </li>
    );
  }
  return (
    <li className="px-4 py-2">
      <div className="flex items-center gap-3">
        <CheckMark checked={item.checked} />
        <span className="min-w-0 text-sm font-medium text-gray-900">{item.name}</span>
      </div>
      {item.issues.length > 0 && (
        <ul className="ml-8 mt-1.5 space-y-1.5">
          {item.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ListSection({ list }: { list: ArchivedList }) {
  const items = list.items.filter((item) => item.type === "item");
  const done = items.filter((item) => item.checked).length;
  const complete = items.length > 0 && done === items.length;
  return (
    <section>
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-inset px-4 py-2">
        <h3 className="min-w-0 truncate text-base font-semibold text-gray-900">{list.name}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            complete ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"
          }`}
        >
          {done}/{items.length}
        </span>
      </div>
      {list.items.length === 0 ? (
        <p className="px-4 py-2 text-sm text-gray-600">No items.</p>
      ) : (
        <ul className="divide-y divide-gray-100 py-1">
          {list.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ArchivePanel({ archive }: { archive: ChecklistArchive }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ChecklistArchiveDetail | null>(null);
  const [failed, setFailed] = useState(false);

  // An archive never changes, so it's only asked for the first time its panel opens.
  useEffect(() => {
    if (!open || detail) return;
    let current = true;
    setFailed(false);
    fetchArchive(archive.id)
      .then((data) => current && setDetail(data))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [open, detail, archive.id]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-300 bg-surface">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-100"
      >
        <svg
          className={`h-4 w-4 shrink-0 text-gray-600 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-gray-900">
            {archiveTitle(archive)}
          </span>
          <span className="mt-0.5 block text-xs text-gray-600">
            {whenFormat.format(archive.archivedAt * 1000)} · Archived by {archive.archivedByName}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-200">
          {failed ? (
            <p className="px-4 py-3 text-sm text-red-600">
              Couldn't load this archive. Close it and open it again to retry.
            </p>
          ) : !detail ? (
            <p className="px-4 py-3 text-sm text-gray-600">Loading…</p>
          ) : detail.snapshot.lists.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-600">There were no checklists.</p>
          ) : (
            detail.snapshot.lists.map((list) => <ListSection key={list.id} list={list} />)
          )}
        </div>
      )}
    </div>
  );
}

export function LogsPage() {
  const [archives, setArchives] = useState<ChecklistArchive[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchArchives()
      .then((page) => {
        setArchives(page.archives);
        setMore(page.more);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  async function showOlder() {
    const last = archives[archives.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await fetchArchives(last.id);
      setArchives((prev) => [...prev, ...page.archives]);
      setMore(page.more);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Logs</h1>

        {failed && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            Couldn't load the logs. Check your connection and try again.
          </p>
        )}

        {archives.length === 0 && !failed ? (
          <p className="py-12 text-center text-gray-600">
            Nothing archived yet. Use Archive and Reset on{" "}
            <Link to="/checklists" className="text-primary-600 underline hover:text-primary-700">
              Checklists
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-3">
            {archives.map((archive) => (
              <ArchivePanel key={archive.id} archive={archive} />
            ))}
          </div>
        )}

        {more && (
          <div className="text-center">
            <button
              type="button"
              onClick={showOlder}
              disabled={loadingMore}
              className="rounded-lg border border-gray-300 bg-surface px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Show older"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
