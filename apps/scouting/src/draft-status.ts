import type { DraftSaveResult } from "./match-drafts";

export function draftStatusText(
  local: DraftSaveResult | "saving",
  submission: "idle" | "failed" | "submitted",
  submitting: boolean,
) {
  if (submitting) return "Submitting…";
  if (submission === "submitted") return "Submitted to the server";
  const prefix = submission === "failed" ? "Not submitted. " : "";
  if (local === "failed")
    return `${prefix}Could not save on this device. Keep this page open and retry.`;
  if (local === "partial")
    return `${prefix}Answers saved on this device; some drawings are not saved. Keep this page open or redraw missing paths.`;
  if (local === "saving") return `${prefix}Saving on this device…`;
  if (local === "saved")
    return submission === "failed"
      ? "Not submitted. Saved on this device."
      : "Saved on this device · Not submitted";
  return `${prefix || "Not submitted yet"}`.trim();
}
