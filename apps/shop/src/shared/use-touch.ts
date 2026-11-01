// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";

/**
 * Detects touch-first devices (tablets, touchscreen monitors) so the UI can
 * switch to larger, finger-friendly tap targets. Combines a coarse-pointer
 * media query with a touch-capability check, and stays reactive if the primary
 * input changes (e.g. a 2-in-1 detaching its keyboard).
 */
export function useTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(detectTouch);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouch(detectTouch());
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isTouch;
}

function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return coarse && hasTouch;
}
