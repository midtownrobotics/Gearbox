import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Chip } from "@g3/ui";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Role } from "../../shared/api";
import { Swatch } from "../../shared/role-colors";

// The editor's toolbar: every role, and Clear. Each mouse button paints with its own tool: a
// left click on a tool puts it on the left button, a middle click on the middle, a right click on
// the right. The number keys pick tools too (1–9, then 0, for the left button; with Shift, for the
// right; the middle has no keys, since Alt and Ctrl with a number switch the browser's tabs), in
// the order each editor drags
// them into. Each editor's order and buttons are kept in their own browser.

/** A role to give, or clearing. */
export type Tool = number | "clear";
export type Buttons = { left: Tool | null; middle: Tool | null; right: Tool | null };
export type MouseButton = keyof Buttons;

/** An editor's choices. A button left out (`undefined`) is on its default; null is empty. */
type Saved = { order: Tool[]; left?: Tool | null; middle?: Tool | null; right?: Tool | null };

const storageKey = (userId: string) => `g3-schedule-tools:${userId}`;
const isTool = (value: unknown): value is Tool =>
  value === "clear" || (typeof value === "number" && Number.isInteger(value));

function load(userId: string): Saved | null {
  try {
    const raw = JSON.parse(
      localStorage.getItem(storageKey(userId)) ?? "null",
    ) as Partial<Saved> | null;
    if (!raw) return null;
    return {
      order: Array.isArray(raw.order) ? raw.order.filter(isTool) : [],
      left: raw.left === undefined ? undefined : isTool(raw.left) ? raw.left : null,
      middle: raw.middle === undefined ? undefined : isTool(raw.middle) ? raw.middle : null,
      right: raw.right === undefined ? undefined : isTool(raw.right) ? raw.right : null,
    };
  } catch {
    return null;
  }
}

function store(userId: string, saved: Saved) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(saved));
  } catch {
    // A private window or blocked storage: it just isn't remembered.
  }
}

/**
 * The tools in this editor's order (roles they haven't placed yet go after, in the team's order)
 * and what each mouse button paints with: the left starts on the first tool (key 1), the right
 * on Clear, the middle on nothing.
 */
export function useTools(userId: string, roles: Role[]) {
  const usable: Tool[] = [...roles.filter((r) => !r.archived).map((r) => r.id), "clear"];
  const [saved, setSaved] = useState<Saved>(() => load(userId) ?? { order: [] });
  const placed = saved.order.filter((tool) => usable.includes(tool));
  const tools = [...placed, ...usable.filter((tool) => !placed.includes(tool))];
  const on = (chosen: Tool | null | undefined, fallback: Tool | null): Tool | null =>
    chosen === undefined ? fallback : chosen !== null && usable.includes(chosen) ? chosen : null;
  const buttons: Buttons = {
    // With no roles yet, the first tool is Clear: nothing for the left button to start on.
    left: on(saved.left, tools[0] === "clear" ? null : tools[0]),
    middle: on(saved.middle, null),
    right: on(saved.right, "clear"),
  };

  const update = useCallback(
    (change: Partial<Saved>) =>
      setSaved((current) => {
        const next = { ...current, ...change };
        store(userId, next);
        return next;
      }),
    [userId],
  );
  return { tools, buttons, update };
}

/** The key that picks the tool at `index`: 1–9, then 0. */
const keyOf = (index: number) => (index < 9 ? String(index + 1) : index === 9 ? "0" : null);

const DIGIT = /^(?:Digit|Numpad)(\d)$/;

export function Tools({
  roles,
  tools,
  buttons,
  onChange,
}: {
  roles: Role[];
  tools: Tool[];
  buttons: Buttons;
  onChange: (change: Partial<Buttons> & { order?: Tool[] }) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const byId = new Map(roles.map((r) => [r.id, r]));

  /** A tool onto a button, or off it when it's already there. */
  const bind = useCallback(
    (button: MouseButton, tool: Tool) => {
      const next = buttons[button] === tool ? null : tool;
      onChange({ [button]: next } as Partial<Buttons>);
    },
    [buttons, onChange],
  );

  // 1–9 and 0 pick the tool in that place for the left button; with Shift, for the right.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const digit = DIGIT.exec(e.code)?.[1];
      if (digit === undefined) return;
      const tool = tools[digit === "0" ? 9 : Number(digit) - 1];
      if (tool === undefined) return;
      e.preventDefault();
      bind(e.shiftKey ? "right" : "left", tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tools, bind]);

  function drop({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = tools.map(String);
    onChange({
      order: arrayMove(tools, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))),
    });
  }

  /** Alt+← and Alt+→ move a focused tool, for reordering without a mouse. */
  function nudge(e: KeyboardEvent, index: number) {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const to = index + (e.key === "ArrowLeft" ? -1 : 1);
    if (to < 0 || to >= tools.length) return;
    e.preventDefault();
    onChange({ order: arrayMove(tools, index, to) });
  }

  if (tools.length === 1) {
    return (
      <p className="text-sm text-secondary-500">
        Add roles on the{" "}
        <Link to="/roles" className="underline">
          Roles
        </Link>{" "}
        page to start assigning.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
        <SortableContext items={tools.map(String)} strategy={horizontalListSortingStrategy}>
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Paint with">
            {tools.map((tool, index) => {
              const role = tool === "clear" ? undefined : byId.get(tool);
              return (
                <ToolButton
                  key={String(tool)}
                  id={String(tool)}
                  digit={keyOf(index)}
                  on={{
                    left: buttons.left === tool,
                    middle: buttons.middle === tool,
                    right: buttons.right === tool,
                  }}
                  onBind={(button) => bind(button, tool)}
                  onKeyDown={(e) => nudge(e, index)}
                >
                  {role ? (
                    <>
                      <Swatch color={role.color} />
                      {role.name}
                    </>
                  ) : (
                    <>
                      <span
                        className="h-3 w-3 rounded-sm border border-dashed border-secondary-500"
                        aria-hidden
                      />
                      Clear
                    </>
                  )}
                </ToolButton>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <p className="text-xs text-secondary-500">
        Click a tool with any mouse button to paint with it using that button. The number keys pick
        tools for the left button, and with Shift for the right. Drag tools to reorder them.
      </p>
    </div>
  );
}

const MARKS: [MouseButton, string, string][] = [
  ["left", "L", "On the left mouse button"],
  ["middle", "M", "On the middle mouse button"],
  ["right", "R", "On the right mouse button"],
];

function ToolButton({
  id,
  digit,
  on,
  onBind,
  onKeyDown,
  children,
}: {
  id: string;
  digit: string | null;
  /** Which mouse buttons it's on. */
  on: Record<MouseButton, boolean>;
  onBind: (button: MouseButton) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const bound = on.left || on.middle || on.right;
  // The wrapper is what's dragged: a press that moves a few pixels picks the tool up, and a click
  // (with any button) reaches the chip.
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`inline-flex touch-none rounded-full ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <Chip
        // A tool on a mouse button is ringed, and its L, M or R says which.
        selected={false}
        aria-pressed={bound}
        aria-keyshortcuts={digit ?? undefined}
        aria-roledescription={attributes["aria-roledescription"]}
        title={[
          digit && `Key ${digit} (Shift+${digit} for the right button)`,
          ...MARKS.filter(([button]) => on[button]).map(([, , label]) => label),
        ]
          .filter(Boolean)
          .join(". ")}
        onClick={() => onBind("left")}
        // The browser's middle-click scrolling would start on the press: not here.
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && onBind("middle")}
        // The page keeps the browser's menu shut (context-menu.ts), except on a double right-click.
        onContextMenu={() => onBind("right")}
        onKeyDown={onKeyDown}
        className={`inline-flex items-center gap-1.5 ${bound ? "border-secondary-900 ring-2 ring-secondary-900" : ""}`}
      >
        {digit && (
          <kbd className="font-sans text-xs text-secondary-400" aria-hidden>
            {digit}
          </kbd>
        )}
        {children}
        {bound && (
          <span className="ml-0.5 inline-flex gap-0.5" aria-hidden>
            {MARKS.filter(([button]) => on[button]).map(([button, mark]) => (
              <Marker key={button}>{mark}</Marker>
            ))}
          </span>
        )}
      </Chip>
    </span>
  );
}

/** Which mouse button a tool is on. */
function Marker({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-secondary-900 px-1 text-[10px] font-bold leading-4 text-white">
      {children}
    </span>
  );
}
