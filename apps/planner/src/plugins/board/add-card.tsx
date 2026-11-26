// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Card, Dialog, Field, focusRing, inputClass } from "@g3/ui";
import { TextField } from "@g3/ui";
import { CalendarClock, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { BoardCard } from "../../shared/api";
import { dayLabel, today } from "../../shared/dates";

/** A new card's dates: when it's due, and the day it goes on the board ("" for neither). */
export type NewCardDates = { dueDate: string | null; startsOn: string | null };

/**
 * Adding a card, above the board: it goes to the bottom of Not Started, at once or on the day
 * it's scheduled for. Options (beside Add card) hold its due date and that day; Scheduled lists
 * the cards still waiting for theirs.
 */
export function AddCard({
  onAdd,
  scheduled,
  onOpen,
}: {
  onAdd: (title: string, dates: NewCardDates) => Promise<boolean>;
  /** Cards waiting for their day, soonest first. */
  scheduled: BoardCard[];
  onOpen: (card: BoardCard) => void;
}) {
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const later = startsOn > today();

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const ok = await onAdd(title.trim(), {
      dueDate: dueDate || null,
      // Today or before is the same as now.
      startsOn: later ? startsOn : null,
    });
    setBusy(false);
    if (ok) {
      setTitle("");
      setDueDate("");
      setStartsOn("");
    }
  }

  return (
    <Card>
      <form onSubmit={add} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextField
            kind="task"
            aria-label="New card"
            placeholder="Add a card to Not Started"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1"
          />
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Card options"
              title="Due date and scheduling"
              aria-expanded={options}
              aria-controls="new-card-options"
              onClick={() => setOptions((open) => !open)}
              className={`relative flex items-center justify-center rounded-lg border border-line px-3 text-secondary-600 hover:bg-inset hover:text-secondary-900 ${options ? "bg-inset" : "bg-surface"} ${focusRing}`}
            >
              <SlidersHorizontal aria-hidden className="size-4" />
              {/* Something is set while the options are closed. */}
              {!options && (dueDate || later) && (
                <span
                  aria-hidden
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-primary-500"
                />
              )}
            </button>
            <Button type="submit" className="flex-1 sm:flex-none" disabled={busy || !title.trim()}>
              {later ? "Schedule card" : "Add card"}
            </Button>
          </div>
        </div>
        {options && (
          <div id="new-card-options" className="grid gap-3 sm:grid-cols-2">
            <DayField label="Due date" value={dueDate} onChange={setDueDate} />
            <DayField
              label="Add to Not Started on"
              hint={
                later
                  ? `It stays off the board until ${dayLabel(startsOn)}.`
                  : "Leave it empty to add it now."
              }
              value={startsOn}
              min={today()}
              onChange={setStartsOn}
            />
          </div>
        )}
        {scheduled.length > 0 && (
          <button
            type="button"
            onClick={() => setListing(true)}
            className={`flex items-center gap-1.5 rounded-md text-sm text-secondary-600 hover:text-secondary-900 ${focusRing}`}
          >
            <CalendarClock aria-hidden className="size-4" />
            {scheduled.length} scheduled
          </button>
        )}
      </form>
      {listing && (
        <Dialog title="Scheduled cards" onClose={() => setListing(false)}>
          {scheduled.length === 0 ? (
            <p className="text-sm text-secondary-500">Nothing is scheduled.</p>
          ) : (
            <ul className="divide-y divide-line">
              {scheduled.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setListing(false);
                      onOpen(card);
                    }}
                    className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-1 py-2 text-left text-sm hover:bg-inset ${focusRing}`}
                  >
                    <span className="min-w-0 text-secondary-900 [overflow-wrap:anywhere]">
                      {card.title}
                    </span>
                    <span className="shrink-0 text-xs text-secondary-500">
                      {card.startsOn && dayLabel(card.startsOn)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </Card>
  );
}

/** A calendar day, or none: a date box with a way to clear it. */
export function DayField({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  min?: string;
  onChange: (day: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          type="date"
          className={`${inputClass} min-w-44 flex-1`}
          value={value}
          min={min}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <Button variant="secondary" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
}
