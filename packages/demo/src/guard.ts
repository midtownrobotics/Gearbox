import type { AppName } from "@g3/site-config";

// What the gateway lets a demo visitor do (roadmap 5.5 and 5.7). The demo's pages only send text
// picked from the safe lists (safe-text.ts) or the demo's own sample data, so this only stops
// someone calling the API by hand:
// - Routes that reach outside the platform or lock visitors out (connecting Slack, kiosks, keys,
//   switching apps off, deleting the shared accounts) are refused for every role.
// - Uploads are refused: any file, and any body that isn't JSON or a form of text.
// - Every string in a JSON body must be made of words the demo already has (`vocabulary`), or be
//   a machine value: a number, an id, a date, a color, a lowercase code like "in-progress".

/** An app, or the platform itself. */
export type DemoWorker = AppName | "platform";

type Blocked = { app: DemoWorker; method: string; path: RegExp };

/** Routes refused on the demo team, by app, method ("*": any) and the path after /api. */
export const DEMO_BLOCKED: readonly Blocked[] = [
  // Sign-in, accounts and kiosks: the three visitor accounts are shared.
  { app: "id", method: "*", path: /^\/slack\/install/ },
  { app: "id", method: "DELETE", path: /^\/admin\/slack$/ },
  { app: "id", method: "PUT", path: /^\/admin\/team\/sign-in/ },
  // Team Appearance: visitors can try the editor, but not save it.
  { app: "id", method: "PUT", path: /^\/admin\/team\/ui/ },
  {
    app: "id",
    method: "POST",
    path: /^\/admin\/users\/[^/]+\/(merge|promote|demote|grant-mentor|revoke-mentor|reject)$/,
  },
  { app: "id", method: "DELETE", path: /^\/admin\/users\// },
  { app: "id", method: "*", path: /^\/admin\/kiosk\// },
  { app: "id", method: "POST", path: /^\/kiosk\/activate/ },
  { app: "id", method: "POST", path: /^\/auth\/(password|pin\/regenerate|login\/email)/ },
  { app: "id", method: "DELETE", path: /^\/auth\/identities\// },
  // The team's apps stay on, and nothing is sent to Slack.
  { app: "platform", method: "PUT", path: /^\/team\/library\// },
  { app: "platform", method: "PUT", path: /^\/team\/notification-settings/ },
  // Integrations: keys, webhooks and boxes stay unconnected.
  { app: "edge", method: "POST", path: /^\/box\/key/ },
  { app: "pit", method: "POST", path: /^\/downloaders\/(codes|pair)/ },
  { app: "edge", method: "*", path: /^\/switch\// },
  { app: "edge", method: "*", path: /^\/print\// },
  { app: "shop", method: "POST", path: /^\/admin\/(onshape|slack)\// },
  { app: "shop", method: "*", path: /^\/print\// },
  { app: "orders", method: "*", path: /^\/share-a-cart\/(connect|callback|disconnect)/ },
  { app: "orders", method: "POST", path: /^\/orders\/import/ },
  // Scouting: reading a photographed schedule runs Workers AI.
  { app: "scouting", method: "POST", path: /^\/scouting\/manual-schedule\/extract/ },
  // Integration keys and every app's settings form (no page saves through it yet).
  { app: "shop", method: "PUT", path: /^\/team-settings/ },
  { app: "orders", method: "PUT", path: /^\/team-settings/ },
  { app: "edge", method: "PUT", path: /^\/team-settings/ },
  { app: "pit", method: "PUT", path: /^\/team-settings/ },
  { app: "attendance", method: "PUT", path: /^\/team-settings/ },
];

/** Whether a request is one the demo refuses whatever its body. */
export function demoBlocked(app: DemoWorker, method: string, path: string): boolean {
  return DEMO_BLOCKED.some(
    (b) => b.app === app && (b.method === "*" || b.method === method) && b.path.test(path),
  );
}

/** A request that writes (and so is checked). */
export const isWrite = (method: string): boolean =>
  method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

/** Words in text: its runs of letters, lowercased. Runs of one or two letters don't count. */
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => word.length > 2);
}

/** Every word in every string anywhere in `value` (nested objects and arrays too). */
export function collectWords(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    for (const word of wordsOf(value)) into.add(word);
  } else if (Array.isArray(value)) {
    for (const item of value) collectWords(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectWords(item, into);
  }
  return into;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#?[0-9a-f]{1,64}$/i;
const CODE = /^[a-z][a-z0-9]*(?:[-_:.][a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Parts of words a lowercase code may not contain. */
const NOT_IN_CODES = ["fuck", "shit", "cunt", "bitch", "nigg", "fagg", "whore", "slut", "porn"];

/**
 * Whether a string from a demo visitor is allowed: a machine value, or text whose words are all
 * in `vocabulary`.
 */
export function allowedText(text: string, vocabulary: ReadonlySet<string>): boolean {
  if (text.length > 2000) return false;
  if (UUID.test(text) || HEX.test(text)) return true;
  if (text.length <= 40 && CODE.test(text)) return clean(text);
  return wordsOf(text).every((word) => vocabulary.has(word));
}

const clean = (code: string) => !NOT_IN_CODES.some((part) => code.toLowerCase().includes(part));

/** Whether an object key is allowed: a name in code ("needBy", "12") or allowed text. */
const allowedKey = (key: string, vocabulary: ReadonlySet<string>) =>
  (key.length <= 40 && IDENTIFIER.test(key) && clean(key)) || allowedText(key, vocabulary);

/** The first string in `value` that isn't allowed (object keys too), or null. */
export function disallowedText(value: unknown, vocabulary: ReadonlySet<string>): string | null {
  if (typeof value === "string") return allowedText(value, vocabulary) ? null : value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = disallowedText(item, vocabulary);
      if (found !== null) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!allowedKey(key, vocabulary)) return key;
      const found = disallowedText(item, vocabulary);
      if (found !== null) return found;
    }
  }
  return null;
}

/** What the gateway answers when it refuses a demo request. */
export const DEMO_REFUSALS = {
  blocked: "That isn't available in the demo.",
  upload: "Uploads are off in the demo.",
  text: "In the demo, pick text with the rotate button instead of typing it.",
  tooFast: "Slow down a little: the demo allows 60 changes a minute.",
} as const;
