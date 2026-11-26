// SPDX-License-Identifier: AGPL-3.0-only
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  type UniqueIdentifier,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ConfirmQuestion, Dialog, ErrorBanner, Page, PageLoading } from "@g3/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type BoardCard, type BoardData, api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import {
  type Column,
  type MiddleColumn,
  allColumns,
  columnName,
  columnOfLane,
  laneId,
} from "../../shared/columns";
import { isScheduled } from "../../shared/dates";
import { AddCard } from "./add-card";
import { CardDialog } from "./card-dialog";
import { BoardColumn, CardFace } from "./column";
import { NoMiddleColumns } from "./no-columns";
import { type People, PeopleContext } from "./people";
import { SendOverview } from "./send-overview";

// The team's board: Not Started, the team's own middle columns, and Done. Cards are dragged
// between and within them. The middle columns are arranged on the Admin page.
// Everyone's board follows the others' by asking for it every few seconds.

/** How often the board asks for everyone's changes. */
const POLL_MS = 5000;

/**
 * The board on screen: the middle columns, each column's cards by its `laneId` (top first), and
 * the cards scheduled for a later day, off the board until then (soonest first).
 */
type Board = { middle: MiddleColumn[]; lanes: Record<string, BoardCard[]>; scheduled: BoardCard[] };

function boardOf(data: BoardData): Board {
  const lanes: Record<string, BoardCard[]> = {};
  for (const column of allColumns(data.columns)) lanes[laneId(column)] = [];
  const scheduled: BoardCard[] = [];
  for (const card of [...data.cards].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    if (isScheduled(card)) scheduled.push(card);
    else (lanes[laneId(card.column)] ?? lanes.not_started).push(card);
  }
  scheduled.sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? "") || a.id - b.id);
  return { middle: data.columns, lanes, scheduled };
}

/** The lane a draggable or droppable id is in: a lane's own id, or a card's. */
function laneOf(board: Board, id: UniqueIdentifier): string | null {
  if (typeof id === "string" && id in board.lanes) return id;
  return (
    Object.keys(board.lanes).find((lane) => board.lanes[lane].some((c) => c.id === id)) ?? null
  );
}

const everyCard = (board: Board) => [...Object.values(board.lanes).flat(), ...board.scheduled];

export function BoardPage() {
  const { canEdit, canAssign, isAdmin, isMentor, userId: me } = useAuthUser();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<BoardCard | null>(null);
  // The open card is in the address (`?card=<id>`), so the Calendar can link to one.
  const [params, setParams] = useSearchParams();
  const editingId = Number(params.get("card")) || null;
  const setEditingId = useCallback(
    (id: number | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id === null) next.delete("card");
          else next.set("card", String(id));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  /** The card an admin asked to delete, waiting for their yes. */
  const [deleting, setDeleting] = useState<BoardCard | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const known = useRef(names);
  known.current = names;
  /** When the names were last asked for: again for someone new on a card, a minute apart. */
  const namesAsked = useRef(0);
  /** The board as it was when a drag started, to put back if it's canceled. */
  const before = useRef<Board | null>(null);
  /** Changes on their way: a poll's answer from before them would undo them on screen. */
  const busy = useRef(0);

  const loadNames = useCallback(async () => {
    namesAsked.current = Date.now();
    const res = await api.cards.people.$get().catch(() => null);
    if (res?.ok) setNames(new Map((await res.json()).map((p) => [p.id, p.displayName])));
  }, []);

  const refresh = useCallback(async () => {
    if (before.current || busy.current > 0) return;
    const res = await api.board.$get().catch(() => null);
    if (!res) return setError("Can't reach Planner. Retrying…");
    if (!res.ok) return setError(await getErrorMessage(res));
    const data = await res.json();
    if (before.current || busy.current > 0) return;
    setBoard(boardOf(data));
    setError(null);
    const someoneNew = data.cards.some((c) => c.memberIds.some((id) => !known.current.has(id)));
    // Whoever puts other people on cards picks from everyone's names, so they're loaded at once.
    const firstTime = canAssign && namesAsked.current === 0;
    if (firstTime || (someoneNew && Date.now() - namesAsked.current > 60_000)) loadNames();
  }, [loadNames, canAssign]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** Runs a change, then shows the board as saved (or the error and the board as it is). */
  const change = useCallback(
    async (call: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>) => {
      busy.current++;
      let failed: string | null = null;
      try {
        const res = await call();
        if (!res.ok) failed = await getErrorMessage(res);
      } catch {
        failed = "Can't reach Planner. Try again.";
      } finally {
        busy.current--;
      }
      await refresh();
      if (failed) setError(failed);
      return !failed;
    },
    [refresh],
  );

  /** Puts someone on a card or takes them off, showing it at once. */
  const setOnCard = useCallback(
    (card: BoardCard, userId: string, on: boolean) => {
      const memberIds = on
        ? [...card.memberIds.filter((id) => id !== userId), userId]
        : card.memberIds.filter((id) => id !== userId);
      const lane = laneId(card.column);
      const update = (c: BoardCard) => (c.id === card.id ? { ...c, memberIds } : c);
      setBoard((current) =>
        current?.lanes[lane]
          ? {
              ...current,
              lanes: { ...current.lanes, [lane]: current.lanes[lane].map(update) },
              scheduled: current.scheduled.map(update),
            }
          : current,
      );
      const id = String(card.id);
      change(() => {
        if (userId === me) {
          const param = { id };
          return on
            ? api.cards[":id"].members.me.$put({ param })
            : api.cards[":id"].members.me.$delete({ param });
        }
        const param = { id, userId };
        return on
          ? api.cards[":id"].members[":userId"].$put({ param })
          : api.cards[":id"].members[":userId"].$delete({ param });
      });
    },
    [me, change],
  );

  const toggleMe = useCallback(
    (card: BoardCard) => setOnCard(card, me, !card.memberIds.includes(me)),
    [me, setOnCard],
  );

  const people = useMemo<People>(
    () => ({
      me,
      canEdit,
      canAssign,
      isAdmin,
      names,
      toggleMe,
      setOnCard,
      askDelete: setDeleting,
    }),
    [me, canEdit, canAssign, isAdmin, names, toggleMe, setOnCard],
  );

  const sensors = useSensors(
    // A short move starts a drag, so a click still opens the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // On a phone, press and hold, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks a card up and puts it down; Enter opens it.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  if (!board) {
    return error ? (
      <Page title="Board">
        <ErrorBanner message={error} />
      </Page>
    ) : (
      <PageLoading />
    );
  }

  function onDragStart({ active }: DragStartEvent) {
    if (!board) return;
    before.current = board;
    setDragged(everyCard(board).find((c) => c.id === active.id) ?? null);
  }

  // Into another column as it's dragged over it, so the card makes room there.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setBoard((current) => {
      if (!current) return current;
      const from = laneOf(current, active.id);
      const to = laneOf(current, over.id);
      const column = to ? columnOfLane(to) : null;
      if (!from || !to || column === null || from === to) return current;
      const card = current.lanes[from].find((c) => c.id === active.id);
      if (!card) return current;
      const target = current.lanes[to];
      const overIndex = target.findIndex((c) => c.id === over.id);
      const at = overIndex >= 0 ? overIndex : target.length;
      return {
        ...current,
        lanes: {
          ...current.lanes,
          [from]: current.lanes[from].filter((c) => c.id !== active.id),
          [to]: [...target.slice(0, at), { ...card, column }, ...target.slice(at)],
        },
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const start = before.current;
    before.current = null;
    setDragged(null);
    if (!board || !start) return;
    const to = over ? laneOf(board, over.id) : null;
    const column = to ? columnOfLane(to) : null;
    if (!over || !to || column === null) {
      setBoard(start);
      return;
    }
    const list = board.lanes[to];
    const oldIndex = list.findIndex((c) => c.id === active.id);
    const overIndex = list.findIndex((c) => c.id === over.id);
    const sorted =
      oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex
        ? arrayMove(list, oldIndex, overIndex)
        : list;
    const index = sorted.findIndex((c) => c.id === active.id);
    const was = laneOf(start, active.id);
    const wasIndex = was ? start.lanes[was].findIndex((c) => c.id === active.id) : -1;
    setBoard({ ...board, lanes: { ...board.lanes, [to]: sorted } });
    if (index < 0 || (was === to && wasIndex === index)) return;
    const id = String(active.id);
    change(() => api.cards[":id"].move.$put({ param: { id }, json: { column, index } }));
  }

  function onDragCancel() {
    if (before.current) setBoard(before.current);
    before.current = null;
    setDragged(null);
  }

  /** Deletes a card (admins only), closing it if it's open. */
  async function remove(card: BoardCard) {
    const ok = await change(() => api.cards[":id"].$delete({ param: { id: String(card.id) } }));
    if (ok && editingId === card.id) setEditingId(null);
    return ok;
  }

  const columns = allColumns(board.middle);
  const editing =
    editingId === null ? null : (everyCard(board).find((c) => c.id === editingId) ?? null);

  return (
    <PeopleContext.Provider value={people}>
      <Page
        title="Board"
        description={
          canEdit
            ? "Add cards and drag them between columns. Everyone on the team sees the same board."
            : "Everyone on the team sees the same board. Sign in on your own device to change it."
        }
        width="full"
        actions={isMentor ? <SendOverview /> : undefined}
      >
        {error && <ErrorBanner message={error} />}
        {canEdit && (
          <AddCard
            onAdd={(title, dates) => change(() => api.cards.$post({ json: { title, ...dates } }))}
            scheduled={board.scheduled}
            onOpen={(card) => setEditingId(card.id)}
          />
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          {/* Side by side from tablet width up, scrolling sideways when there are many. */}
          <div className="relative overflow-x-auto pb-2">
            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              {columns.map((column) => (
                <div key={laneId(column)} className="contents">
                  {/* No columns between Not Started and Done yet: where they'd be. */}
                  {column === "done" && !board.middle.length && <NoMiddleColumns />}
                  <BoardColumn
                    lane={laneId(column)}
                    label={columnName(column, board.middle)}
                    cards={board.lanes[laneId(column)] ?? []}
                    canEdit={canEdit}
                    onOpen={(card) => setEditingId(card.id)}
                  />
                </div>
              ))}
            </div>
          </div>
          <DragOverlay>{dragged && <CardFace card={dragged} lifted />}</DragOverlay>
        </DndContext>
        {editing && (
          <CardDialog
            card={editing}
            columns={columns.map((column) => ({
              column,
              name: columnName(column, board.middle),
            }))}
            canEdit={canEdit}
            onClose={() => setEditingId(null)}
            onSave={(changes) =>
              change(() =>
                api.cards[":id"].$patch({ param: { id: String(editing.id) }, json: changes }),
              )
            }
            onMove={(column: Column) =>
              change(() =>
                api.cards[":id"].move.$put({
                  param: { id: String(editing.id) },
                  json: { column, index: board.lanes[laneId(column)]?.length ?? 0 },
                }),
              )
            }
            onDelete={() => remove(editing)}
          />
        )}
        {deleting && (
          <Dialog title="Delete card" onClose={() => setDeleting(null)}>
            <ConfirmQuestion
              question={`Delete "${deleting.title}" for everyone? This can't be undone.`}
              confirmLabel="Delete"
              keepLabel="Keep it"
              onConfirm={async () => {
                if (await remove(deleting)) setDeleting(null);
              }}
              onKeep={() => setDeleting(null)}
            />
          </Dialog>
        )}
      </Page>
    </PeopleContext.Provider>
  );
}
