/**
 * Match report drafts kept on this device, so nothing a scout has written is lost: not to a reload,
 * a dead battery or a dropped connection, and not when the form moves on to the next match. A
 * draft is per scout, form and match; one whose match has moved on is offered to send late.
 */

export type MatchDraft = {
  formId: string;
  matchKey: string;
  matchLabel: string;
  teamName: string;
  answers: Record<string, unknown>;
  /** Field map drawings by field id, as data URLs of the whole canvas. */
  drawings: Record<string, string>;
  savedAt: number;
};

const PREFIX = "g3-scouting-draft:";
/** Drafts older than this are gone: a late report is long past being taken. */
const KEEP_MS = 12 * 60 * 60 * 1000;
const MAX_DRAFTS = 8;

function keyOf(userId: string, formId: string, matchKey: string) {
  return `${PREFIX}${userId}:${formId}:${matchKey}`;
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(userId: string) {
  const store = storage();
  if (!store) return [];
  const drafts: { key: string; draft: MatchDraft }[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key?.startsWith(`${PREFIX}${userId}:`)) continue;
      try {
        const draft = JSON.parse(store.getItem(key) ?? "") as MatchDraft;
        if (draft?.matchKey && draft.formId) drafts.push({ key, draft });
      } catch {
        store.removeItem(key);
      }
    }
  } catch {
    return [];
  }
  return drafts;
}

/** Whether a draft holds anything the scout wrote. */
export function hasContent(draft: Pick<MatchDraft, "answers" | "drawings">) {
  return (
    Object.keys(draft.drawings).length > 0 ||
    Object.values(draft.answers).some(
      (value) =>
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0),
    )
  );
}

/** Drops drafts past keeping, then the oldest beyond the limit. */
function prune(userId: string) {
  const store = storage();
  if (!store) return;
  const now = Date.now();
  const drafts = readAll(userId).sort((left, right) => right.draft.savedAt - left.draft.savedAt);
  drafts.forEach(({ key, draft }, index) => {
    if (index >= MAX_DRAFTS || now - draft.savedAt > KEEP_MS) {
      try {
        store.removeItem(key);
      } catch {
        // Nothing to do: storage is unavailable.
      }
    }
  });
}

/** Saves a draft, or removes it once it's empty. Keeps the answers if drawings don't fit. */
export function saveDraft(userId: string, draft: MatchDraft) {
  const store = storage();
  if (!store) return;
  const key = keyOf(userId, draft.formId, draft.matchKey);
  try {
    if (!hasContent(draft)) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify(draft));
  } catch {
    // Full: make room and try again, then without the drawings, which are most of the size.
    prune(userId);
    try {
      store.setItem(key, JSON.stringify(draft));
    } catch {
      try {
        store.setItem(key, JSON.stringify({ ...draft, drawings: {} }));
      } catch {
        // Storage won't take it: the form itself still works.
      }
    }
  }
}

export function loadDraft(userId: string, formId: string, matchKey: string) {
  try {
    const raw = storage()?.getItem(keyOf(userId, formId, matchKey));
    if (!raw) return null;
    const draft = JSON.parse(raw) as MatchDraft;
    return Date.now() - draft.savedAt > KEEP_MS ? null : draft;
  } catch {
    return null;
  }
}

export function deleteDraft(userId: string, formId: string, matchKey: string) {
  try {
    storage()?.removeItem(keyOf(userId, formId, matchKey));
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

/** This scout's drafts for a form with something in them, newest first. */
export function listDrafts(userId: string, formId: string) {
  prune(userId);
  return readAll(userId)
    .map(({ draft }) => draft)
    .filter((draft) => draft.formId === formId && hasContent(draft))
    .sort((left, right) => right.savedAt - left.savedAt);
}

export async function dataUrlToBlob(url: string) {
  return (await fetch(url)).blob();
}
