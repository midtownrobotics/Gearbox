// SPDX-License-Identifier: AGPL-3.0-only
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { focusRing } from "@g3/ui";
import { CalendarClock } from "lucide-react";
import type { BoardCard } from "../../shared/api";
import { dayLabel, dueState } from "../../shared/dates";
import { CardActions, CardPeople } from "./people";

/** The width every column has side by side; on a phone they're stacked, full width. */
export const COLUMN_WIDTH = "md:w-72 md:shrink-0";

/** One column: its cards, in order. */
export function BoardColumn({
  lane,
  label,
  cards,
  canEdit,
  onOpen,
}: {
  /** Its drag and drop id (`laneId`). */
  lane: string;
  label: string;
  cards: BoardCard[];
  canEdit: boolean;
  onOpen: (card: BoardCard) => void;
}) {
  // The column itself takes a drop too, so an empty one can be dropped into.
  const { setNodeRef, isOver } = useDroppable({ id: lane, disabled: !canEdit });
  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-xl border border-line bg-inset p-3 ${COLUMN_WIDTH}`}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-secondary-700" title={label}>
          {label}
        </h2>
        <span className="shrink-0 text-xs text-secondary-500">{cards.length}</span>
      </div>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex min-h-16 flex-1 flex-col gap-2 rounded-lg ${isOver && !cards.length ? "bg-primary-50" : ""}`}
        >
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} canEdit={canEdit} onOpen={onOpen} />
          ))}
          {!cards.length && (
            <li className="px-1 py-4 text-center text-sm text-secondary-400">No cards</li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

/** A card's look, on the board and while it's being dragged. */
export function CardFace({ card, lifted = false }: { card: BoardCard; lifted?: boolean }) {
  return (
    <div
      className={`space-y-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm ${lifted ? "shadow-lg" : "shadow-sm"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-secondary-900 [overflow-wrap:anywhere]">{card.title}</p>
        {!lifted && <CardActions card={card} />}
      </div>
      {card.dueDate && <DueDate day={card.dueDate} done={card.column === "done"} />}
      <CardPeople card={card} />
    </div>
  );
}

/** "Due Fri, Nov 21": red once it's past, amber due today or tomorrow, gray when it's done. */
export function DueDate({ day, done = false }: { day: string; done?: boolean }) {
  const state = done ? "later" : dueState(day);
  const tone =
    state === "overdue"
      ? "font-medium text-red-700"
      : state === "soon"
        ? "font-medium text-amber-700"
        : "text-secondary-500";
  return (
    <p className={`flex items-center gap-1 text-xs ${tone}`}>
      <CalendarClock aria-hidden className="size-3.5 shrink-0" />
      {state === "overdue" ? "Overdue: " : "Due "}
      {dayLabel(day)}
    </p>
  );
}

function SortableCard({
  card,
  canEdit,
  onOpen,
}: {
  card: BoardCard;
  canEdit: boolean;
  onOpen: (card: BoardCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-40" : ""}
    >
      <div
        {...attributes}
        {...listeners}
        aria-roledescription={canEdit ? "card: Space to pick up, Enter to open" : "card"}
        onClick={() => onOpen(card)}
        onKeyDown={(e) => {
          if (e.key === "Enter") return onOpen(card);
          listeners?.onKeyDown?.(e);
        }}
        className={`rounded-lg ${focusRing} ${canEdit ? "cursor-grab touch-manipulation active:cursor-grabbing" : "cursor-pointer"}`}
      >
        <CardFace card={card} />
      </div>
    </li>
  );
}
