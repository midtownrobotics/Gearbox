import { useEffect, useState } from "react";

// Times on the Monitor: how long until a moment, and a moment as a clock time.

function formatCountdown(targetMs: number): string {
  const remaining = targetMs - Date.now();
  if (remaining <= 0) return "Now";
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatTime(ms?: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

/** How long until `targetMs`, ticking on its own so the rest of the page doesn't redraw. */
export function Countdown({ targetMs }: { targetMs: number }) {
  const [text, setText] = useState(() => formatCountdown(targetMs));
  useEffect(() => {
    setText(formatCountdown(targetMs));
    const interval = setInterval(() => setText(formatCountdown(targetMs)), 250);
    return () => clearInterval(interval);
  }, [targetMs]);
  return <>{text}</>;
}
