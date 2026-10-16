import { Button, Dialog, ErrorBanner, Field, TextField, focusRing, inputClass } from "@g3/ui";
import { useEffect, useState } from "react";
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

const fieldClass = `${inputClass} disabled:bg-inset disabled:text-secondary-500`;

/**
 * The "Archive and reset" pop-up: what the archive is for (event, type, details), then Archive.
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
    <Dialog
      title="Archive and reset"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <p className="text-sm text-secondary-500">
        Saves the checklists to Archives and unchecks every item. Open issues stay.
      </p>

      <Field label="Event">
        <div className="relative">
          <TextField
            variant="plain"
            kind="event"
            value={atEvent ? lockedEvent : event}
            onChange={(e) => setEvent(e.target.value)}
            disabled={atEvent || eventKnown === null}
            maxLength={60}
            className={`${fieldClass} ${atEvent ? "pr-10" : ""}`}
          />
          {atEvent && (
            <svg
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-500"
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
      </Field>

      {/* The chosen one is near-black, like a chosen filter: the team's color is the Archive button. */}
      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-secondary-300">
        {TYPES.map((option) => {
          const on = option === selected;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => setType(option)}
              className={`border-l border-secondary-300 px-3 py-2.5 text-sm font-semibold first:border-l-0 ${focusRing} ${
                on
                  ? "bg-secondary-900 text-white"
                  : "bg-surface text-secondary-700 hover:bg-secondary-50"
              }`}
            >
              {ARCHIVE_TYPE_LABELS[option]}
            </button>
          );
        })}
      </div>

      <Field label="Details">
        <TextField
          variant="plain"
          kind="text"
          value={shownDetails}
          onChange={(e) => {
            if (selected === "match") setMatchEdited(true);
            setDetails((prev) => ({ ...prev, [selected]: e.target.value }));
          }}
          placeholder={selected === "match" && findingMatch ? "Finding the next match…" : ""}
          maxLength={120}
          className={fieldClass}
        />
      </Field>

      {error && <ErrorBanner message={error} />}

      <Button
        size="lg"
        className="w-full"
        onClick={archive}
        disabled={saving || (selected === "match" && findingMatch && !matchEdited)}
      >
        {saving ? "Archiving…" : "Archive"}
      </Button>
    </Dialog>
  );
}
