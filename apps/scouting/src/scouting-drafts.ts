export type ScoutingDraft = {
  assignment: string;
  fields: string;
  expiresAt: number | null;
  teamName: string;
  answers: Record<string, unknown>;
  drawings: Record<string, string>;
};

export function readScoutingDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
  assignment: string,
  fields: string,
  now: number,
): ScoutingDraft | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as ScoutingDraft;
    if (
      draft.assignment !== assignment ||
      draft.fields !== fields ||
      (draft.expiresAt !== null && (!Number.isFinite(draft.expiresAt) || draft.expiresAt <= now)) ||
      typeof draft.teamName !== "string" ||
      !draft.answers ||
      typeof draft.answers !== "object" ||
      Array.isArray(draft.answers) ||
      !draft.drawings ||
      typeof draft.drawings !== "object" ||
      Array.isArray(draft.drawings) ||
      Object.values(draft.drawings).some(
        (value) => typeof value !== "string" || !value.startsWith("data:image/png;base64,"),
      )
    )
      throw new Error("Stale draft");
    return draft;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
