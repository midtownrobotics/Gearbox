import { Badge, Button, ErrorBanner, Loading, Page, focusRing, tones } from "@g3/ui";
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

// Logs: every archive of the checklists ("Archive and reset" on the Checklists page), newest
// first. A panel opens to everything that was in the checklists then, in one list.

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// Fixed colors because they mean something: red for a new problem, amber for one still waiting,
// green for one that's done.
const STATUS: Record<ArchivedIssueStatus, { label: string; colors: string; icon: string }> = {
  new: { label: "New", colors: tones.danger, icon: "M12 8v5M12 16.5v.5" },
  open: { label: "Still Open", colors: tones.warning, icon: "M12 7.5V12l3 2" },
  resolved: { label: "Resolved", colors: tones.success, icon: "M8 12.5l2.5 2.5L16 9.5" },
};

function StatusBadge({ status }: { status: ArchivedIssueStatus }) {
  const { label, colors, icon } = STATUS[status];
  return (
    <Badge
      colors={colors}
      icon={
        <svg
          className="h-3.5 w-3.5"
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
      }
    >
      {label}
    </Badge>
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
      } ${checked ? "border-primary-500 bg-primary-500" : "border-secondary-400"}`}
    >
      {checked && (
        <svg
          viewBox="0 0 12 10"
          className={`fill-none stroke-on-primary stroke-2 ${small ? "h-2 w-2.5" : "h-2.5 w-3"}`}
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
      <span className="min-w-0 flex-1 text-sm leading-snug text-secondary-700">{issue.text}</span>
      <StatusBadge status={issue.status} />
    </li>
  );
}

function ItemRow({ item }: { item: ArchivedItem }) {
  if (item.type === "topic") {
    return (
      <li className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-widest text-secondary-500">
        {item.name}
      </li>
    );
  }
  return (
    <li className="px-4 py-2">
      <div className="flex items-center gap-3">
        <CheckMark checked={item.checked} />
        <span className="min-w-0 text-sm font-medium text-secondary-900">{item.name}</span>
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
      <div className="flex items-center justify-between gap-3 border-b border-secondary-200 bg-inset px-4 py-2">
        <h3 className="min-w-0 truncate font-sans text-base font-semibold text-secondary-900">
          {list.name}
        </h3>
        <Badge colors={complete ? tones.success : tones.neutral}>
          {done}/{items.length}
        </Badge>
      </div>
      {list.items.length === 0 ? (
        <p className="px-4 py-2 text-sm text-secondary-500">No items.</p>
      ) : (
        <ul className="divide-y divide-secondary-100 py-1">
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
    <div className="overflow-hidden rounded-xl border border-secondary-200 bg-surface">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary-50 ${focusRing}`}
      >
        <svg
          className={`h-4 w-4 shrink-0 text-secondary-500 transition-transform ${open ? "rotate-90" : ""}`}
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
          <span className="block text-base font-semibold text-secondary-900">
            {archiveTitle(archive)}
          </span>
          <span className="mt-0.5 block text-xs text-secondary-500">
            {whenFormat.format(archive.archivedAt * 1000)} · Archived by {archive.archivedByName}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-secondary-200">
          {failed ? (
            <p className="px-4 py-3 text-sm text-red-700">
              Couldn't load this archive. Close it and open it again to retry.
            </p>
          ) : !detail ? (
            <p className="px-4 py-3 text-sm text-secondary-400">Loading…</p>
          ) : detail.snapshot.lists.length === 0 ? (
            <p className="px-4 py-3 text-sm text-secondary-500">There were no checklists.</p>
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
      <Page title="Logs" width="narrow">
        <Loading />
      </Page>
    );
  }

  return (
    <Page title="Logs" width="narrow">
      {failed && (
        <ErrorBanner message="Couldn't load the logs. Check your connection and try again." />
      )}

      {archives.length === 0 && !failed ? (
        <p className="text-sm text-secondary-500">
          Nothing archived yet. Use Archive and reset on{" "}
          <Link to="/checklists" className="font-semibold text-primary-600 hover:underline">
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
          <Button variant="secondary" onClick={showOlder} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show older"}
          </Button>
        </div>
      )}
    </Page>
  );
}
