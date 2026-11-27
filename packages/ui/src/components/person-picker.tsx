// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useMemo, useState } from "react";
import { TextField } from "./text-field";

// Choosing one of the team's members by typing part of their name, or opening the list: a box
// that searches the people a page gives it (it fetches nothing itself). Every page that picks a
// person uses it, never a <select> of names.
//
// Two ways to use it:
// - Without `value`, choosing someone hands back their id and empties the box, ready for the
//   next (adding people to a list).
// - With `value`, the box shows the chosen person's name, and choosing someone else replaces
//   them (a form's "who").

export type PersonOption = {
  id: string;
  displayName: string;
  /** Shown after the name, such as "Admin", an email or "no Slack linked". */
  note?: string;
  /** Listed but can't be chosen (say why in `note`). */
  disabled?: boolean;
};

/** The most names the list shows at once; typing narrows it. */
const SHOWN = 50;

export function PersonPicker({
  people,
  onPick,
  value,
  label,
  placeholder = "Search people…",
  emptyText = "Nobody left to add.",
  disabled,
  id,
  className = "",
}: {
  /** Who can be chosen (leave out anyone already added). */
  people: PersonOption[];
  onPick: (id: string) => void;
  /** The chosen person's id ("" or null for nobody yet): the box keeps showing their name. */
  value?: string | null;
  /** What it's for, read out by screen readers ("Add someone to this card"). */
  label: string;
  placeholder?: string;
  /** The box's placeholder when there's nobody to choose. */
  emptyText?: string;
  disabled?: boolean;
  /** For a <label htmlFor>. */
  id?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  /** Typing, or the list open: the box shows what's typed rather than the chosen name. */
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = `${useId()}-people`;
  const chosen = value ? people.find((p) => p.id === value) : undefined;

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    const sorted = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
    const found = term
      ? sorted
          .filter(
            (p) =>
              p.displayName.toLowerCase().includes(term) || !!p.note?.toLowerCase().includes(term),
          )
          // Names with a word starting with what's typed first.
          .sort(
            (a, b) =>
              Number(!startsAWord(a.displayName, term)) - Number(!startsAWord(b.displayName, term)),
          )
      : sorted;
    return found.slice(0, SHOWN);
  }, [people, query]);

  function pick(person: PersonOption) {
    if (person.disabled) return;
    onPick(person.id);
    setQuery("");
    setActive(0);
    setOpen(false);
  }

  /** The next option that can be chosen, from `from` in `step`'s direction. */
  function next(from: number, step: 1 | -1) {
    for (let i = from + step; i >= 0 && i < matches.length; i += step) {
      if (!matches[i].disabled) return i;
    }
    return from;
  }

  const nobody = people.length === 0 && !chosen;

  return (
    <div className={`relative min-w-0 ${className}`}>
      <TextField
        typeable
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open && !nobody}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled || nobody}
        value={open ? query : (chosen?.displayName ?? "")}
        placeholder={nobody ? emptyText : chosen ? chosen.displayName : placeholder}
        onFocus={() => {
          setQuery("");
          setActive(
            Math.max(
              0,
              matches.findIndex((p) => !p.disabled),
            ),
          );
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => next(i, 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => next(i, -1));
          } else if (e.key === "Enter") {
            // Never submits the form it's in.
            e.preventDefault();
            const person = matches[active]?.disabled
              ? matches.find((p) => !p.disabled)
              : matches[active];
            if (open && person) pick(person);
          } else if (e.key === "Escape" && open) {
            // Closes the list, not the dialog it's in.
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && !nobody && (
        // The box keeps the focus (aria-activedescendant); -1 only so the roles count as focusable.
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          className="absolute z-20 mt-1 max-h-56 w-full min-w-48 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
          // Scrolling the list mustn't take the focus from the box (which would close it).
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-secondary-500">Nobody by that name.</p>
          ) : (
            matches.map((person, i) => (
              <div
                key={person.id}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                aria-disabled={person.disabled || undefined}
                // Before the box's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(person);
                }}
                onMouseEnter={() => !person.disabled && setActive(i)}
                className={`flex min-w-0 items-center gap-2 px-3 py-2 text-sm ${
                  person.disabled
                    ? "cursor-default text-secondary-400"
                    : `cursor-pointer text-secondary-900 ${i === active ? "bg-inset" : ""}`
                }`}
              >
                <span className="min-w-0 flex-1 truncate" title={person.displayName}>
                  {person.displayName}
                  {person.id === value && <span className="sr-only"> (chosen)</span>}
                </span>
                {person.note && (
                  <span className="max-w-[50%] shrink-0 truncate text-xs text-secondary-500">
                    {person.note}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const startsAWord = (name: string, term: string) =>
  name
    .toLowerCase()
    .split(/\s+/)
    .some((word) => word.startsWith(term));
