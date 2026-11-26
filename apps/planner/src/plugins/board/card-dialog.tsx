// SPDX-License-Identifier: AGPL-3.0-only
import { Button, ConfirmButton, Dialog, Field, TextField, inputClass } from "@g3/ui";
import { type FormEvent, useState } from "react";
import type { BoardCard } from "../../shared/api";
import { type Column, laneId } from "../../shared/columns";
import { dayLabel, isScheduled, today } from "../../shared/dates";
import { DayField } from "./add-card";
import { DueDate } from "./column";
import { AssignPeople, CardPeople, ToggleMe, usePeople } from "./people";

/** What saving a card's dialog changes. */
export type CardChanges = { title?: string; dueDate?: string | null; startsOn?: string | null };

/**
 * A card opened from the board: rename it, set its due date, schedule it (one in Not Started),
 * move it to another column, or delete it. Mentors, admins and trusted students also put anyone
 * on it or take them off.
 */
export function CardDialog({
  card,
  columns,
  canEdit,
  onClose,
  onSave,
  onMove,
  onDelete,
}: {
  card: BoardCard;
  /** Every column, left to right, with its name. */
  columns: { column: Column; name: string }[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (changes: CardChanges) => Promise<boolean>;
  onMove: (column: Column) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [title, setTitle] = useState(card.title);
  const [column, setColumn] = useState<Column>(card.column);
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");
  const [startsOn, setStartsOn] = useState(isScheduled(card) ? (card.startsOn ?? "") : "");
  const later = startsOn > today();
  const where = columns.find((c) => c.column === card.column)?.name ?? "Card";
  const [busy, setBusy] = useState(false);
  const { isAdmin, canAssign } = usePeople();

  if (!canEdit) {
    return (
      <Dialog title={where} onClose={onClose}>
        <div className="space-y-3">
          <p className="text-secondary-900 [overflow-wrap:anywhere]">{card.title}</p>
          {card.dueDate && <DueDate day={card.dueDate} done={card.column === "done"} />}
          {isScheduled(card) && card.startsOn && (
            <p className="text-sm text-secondary-500">
              Goes on the board {dayLabel(card.startsOn)}.
            </p>
          )}
          <CardPeople card={card} />
        </div>
      </Dialog>
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const changes: CardChanges = {};
    if (title.trim() !== card.title) changes.title = title.trim();
    if ((dueDate || null) !== card.dueDate) changes.dueDate = dueDate || null;
    // Moved out of Not Started, or the day is today or past: it's on the board now.
    const scheduledFor = column === "not_started" && later ? startsOn : null;
    const wasFor = isScheduled(card) ? card.startsOn : null;
    if (scheduledFor !== wasFor) changes.startsOn = scheduledFor;
    let ok = true;
    if (Object.keys(changes).length) ok = await onSave(changes);
    if (ok && column !== card.column) ok = await onMove(column);
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    setBusy(true);
    const ok = await onDelete();
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog title="Card" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Title">
          <TextField
            kind="task"
            autoFocus
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-secondary-700">On this card</span>
            <ToggleMe card={card} />
          </div>
          {canAssign ? (
            <AssignPeople card={card} />
          ) : card.memberIds.length ? (
            <CardPeople card={card} />
          ) : (
            <p className="text-sm text-secondary-500">Nobody yet.</p>
          )}
        </div>
        <div className="space-y-3">
          <DayField label="Due date" value={dueDate} onChange={setDueDate} />
          {column === "not_started" && (
            <DayField
              label="Add to Not Started on"
              hint={
                later
                  ? `Off the board until ${dayLabel(startsOn)}.`
                  : "Empty: it's on the board now."
              }
              value={startsOn}
              min={today()}
              onChange={setStartsOn}
            />
          )}
        </div>
        <Field label="Column">
          <select
            className={`${inputClass} max-w-full`}
            value={laneId(column)}
            onChange={(e) => {
              const picked = columns.find((c) => laneId(c.column) === e.target.value);
              if (picked) setColumn(picked.column);
            }}
          >
            {columns.map((c) => (
              <option key={laneId(c.column)} value={laneId(c.column)}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isAdmin ? (
            <ConfirmButton
              label="Delete"
              question="Delete this card for everyone?"
              disabled={busy}
              onConfirm={remove}
            />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
