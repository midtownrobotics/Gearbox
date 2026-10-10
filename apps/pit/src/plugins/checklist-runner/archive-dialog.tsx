import { useEffect, useId, useState } from "react";
import { getErrorMessage } from "../../shared/api-error";
import { createArchive, fetchArchiveDefaults, fetchNextMatch } from "../../shared/getters/archives";
import {
  ARCHIVE_TYPE_LABELS,
  type ArchiveDefaults,
  type ArchiveType,
  type ChecklistArchive,
} from "../../shared/getters/types";

const TYPES: ArchiveType[] = ["match", "practice", "other"];
/** How long the pop-up waits for the team's event and next match before going on without. */
const WAIT_MS = 5000;

const fieldClass =
  "w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-base text-gray-900 placeholder-gray-500 focus:outline-none focus:border-primary-600 disabled:bg-inset disabled:text-gray-600";

/**
 * The "Archive and Reset" pop-up: what the archive is for (event, type, details), then Archive.
 * `known` is what the page already knows about the team's event, shown until it's asked for
 * again; the next match is looked up each time the pop-up opens.
 */
export function ArchiveDialog({
  known,
  onClose,
  onArchived,
}: {
  known: ArchiveDefaults | null;
  onClose: () => void;
  onArchived: (archive: ChecklistArchive) => void;
}) {
  const id = useId();
  const [fresh, setFresh] = useState<ArchiveDefaults | null>(null);
  // The team's next match at its event; null while it's being looked up.
  const [nextMatch, setNextMatch] = useState<string | null>(null);
  const [event, setEvent] = useState("");
  const [type, setType] = useState<ArchiveType | null>(null);
  // Each type keeps its own Details, so switching away and back loses nothing.
  const [details, setDetails] = useState<Record<ArchiveType, string>>({
    match: "",
    practice: "",
    other: "",
  });
  const [matchEdited, setMatchEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The team's event, asked for again in case its settings changed while the page was open.
  useEffect(() => {
    let current = true;
    const settle = (value: ArchiveDefaults) => {
      if (current) setFresh((prev) => prev ?? value);
    };
    const fallback = known ?? { event: "" };
    fetchArchiveDefaults()
      .then(settle)
      .catch(() => settle(fallback));
    const timer = setTimeout(() => settle(fallback), WAIT_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [known]);

  const eventKnown = fresh ?? known;
  const lockedEvent = eventKnown?.event ?? "";
  const atEvent = lockedEvent !== "";

  // At an event, its next official match.
  useEffect(() => {
    if (!atEvent) return;
    let current = true;
    const settle = (value: string) => {
      if (current) setNextMatch((prev) => prev ?? value);
    };
    fetchNextMatch()
      .then(settle)
      .catch(() => settle(""));
    const timer = setTimeout(() => settle(""), WAIT_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [atEvent]);

  // A team at an event is most likely archiving a match; anywhere else, a practice.
  const selected = type ?? (atEvent ? "match" : "practice");
  const findingMatch = eventKnown === null || (atEvent && nextMatch === null);
  const shownDetails =
    selected === "match" && !matchEdited ? (atEvent ? (nextMatch ?? "") : "") : details[selected];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function archive() {
    setSaving(true);
    setError(null);
    try {
      const res = await createArchive({
        event: atEvent ? lockedEvent : event.trim(),
        type: selected,
        details: shownDetails.trim(),
      });
      if (!res.ok) {
        setError(await getErrorMessage(res as unknown as Response));
        return;
      }
      onArchived((await res.json()) as ChecklistArchive);
    } catch {
      setError("Couldn't archive the checklists. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-md space-y-4 rounded-xl bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`${id}-title`} className="text-xl font-bold text-gray-900">
              Archive and Reset
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Saves the checklists to Logs and unchecks every item. Open issues stay.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-event`} className="block text-sm font-medium text-gray-700">
            Event
          </label>
          <div className="relative">
            <input
              id={`${id}-event`}
              type="text"
              value={atEvent ? lockedEvent : event}
              onChange={(e) => setEvent(e.target.value)}
              disabled={atEvent || eventKnown === null}
              maxLength={60}
              className={`${fieldClass} ${atEvent ? "pr-10" : ""}`}
            />
            {atEvent && (
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-300">
          {TYPES.map((option) => {
            const on = option === selected;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => setType(option)}
                className={`border-l border-gray-300 px-3 py-2.5 text-sm font-semibold transition-colors first:border-l-0 ${
                  on
                    ? "bg-primary-600 text-white"
                    : "bg-surface text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {ARCHIVE_TYPE_LABELS[option]}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-details`} className="block text-sm font-medium text-gray-700">
            Details
          </label>
          <input
            id={`${id}-details`}
            type="text"
            value={shownDetails}
            onChange={(e) => {
              if (selected === "match") setMatchEdited(true);
              setDetails((prev) => ({ ...prev, [selected]: e.target.value }));
            }}
            placeholder={selected === "match" && findingMatch ? "Finding the next match…" : ""}
            maxLength={120}
            className={fieldClass}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={archive}
          disabled={saving || (selected === "match" && findingMatch && !matchEdited)}
          className="w-full rounded-lg bg-primary-600 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
        >
          {saving ? "Archiving…" : "Archive"}
        </button>
      </div>
    </div>
  );
}
