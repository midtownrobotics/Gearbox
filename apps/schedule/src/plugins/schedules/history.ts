import { useCallback, useEffect, useState } from "react";
import type { Change } from "../../shared/api";

// Undo and redo for painting the grid: each paint is a step, with the changes that made it and the
// changes that put back what it replaced. Ctrl+Z (Cmd+Z) undoes; Ctrl+Y or Ctrl+Shift+Z redoes.
// A new paint clears what could be redone; the history starts empty each time the page loads.

type Step = { done: Change[]; undone: Change[] };

/** The most steps kept to undo. */
const LIMIT = 100;

export function useHistory(send: (changes: Change[]) => void, enabled: boolean) {
  const [past, setPast] = useState<Step[]>([]);
  const [future, setFuture] = useState<Step[]>([]);

  const record = useCallback((done: Change[], undone: Change[]) => {
    setPast((steps) => [...steps.slice(1 - LIMIT), { done, undone }]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    const step = past[past.length - 1];
    if (!step) return;
    setPast(past.slice(0, -1));
    setFuture((steps) => [...steps, step]);
    send(step.undone);
  }, [past, send]);

  const redo = useCallback(() => {
    const step = future[future.length - 1];
    if (!step) return;
    setFuture(future.slice(0, -1));
    setPast((steps) => [...steps, step]);
    send(step.done);
  }, [future, send]);

  /** Forgets every step (after a save failed and the page reloaded the schedule). */
  const clear = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // In a text box the keys undo typing, as usual.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, undo, redo]);

  return { canUndo: past.length > 0, canRedo: future.length > 0, undo, redo, record, clear };
}
