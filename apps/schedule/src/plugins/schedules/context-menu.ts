import { useEffect } from "react";

// On a schedule's page an editor paints with the right mouse button, so a right-click there
// doesn't open the browser's menu. Two right-clicks in quick succession do: the second opens it
// as usual. Only this page: the rest of the app keeps the browser's menu.

/** How close together two right-clicks must be to open the browser's menu. */
const DOUBLE_CLICK_MS = 400;

export function useMenuOnDoubleRightClick(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    // On the document, in the capture phase: before the page's own right-click handlers.
    const onContextMenu = (e: MouseEvent) => {
      const now = e.timeStamp;
      if (now - last < DOUBLE_CLICK_MS) {
        // The second of two: the browser's menu, and nothing else (no tool is picked).
        last = 0;
        e.stopPropagation();
        return;
      }
      last = now;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, [enabled]);
}
