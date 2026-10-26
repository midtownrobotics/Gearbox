import {
  DEMO_REFUSALS,
  type DemoWorker,
  baseVocabulary,
  demoBlocked,
  demoOutsideReadRefused,
  disallowedText,
  isWrite,
} from "@g3/demo";

// The public demo's checks (roadmap 5.5 and 5.7), for requests to the demo team's API: routes it
// refuses, a rate limit on changes per visitor, no uploads, and only words the demo already has
// (@g3/demo's guard). The demo's pages never trip them; they stop the API being called by hand.

/** The apps with sample data, which say the words in it (`GET /api/internal/demo/words`). */
const WORD_APPS = {
  orders: "ORDERS",
  shop: "SHOP",
  pit: "PIT",
  attendance: "ATTENDANCE",
  skillTree: "SKILL_TREE",
  inventory: "INVENTORY",
  schedule: "SCHEDULE",
  edge: "EDGE",
  scouting: "SCOUTING",
} as const;

export type DemoEnv = Record<(typeof WORD_APPS)[keyof typeof WORD_APPS], Fetcher> & {
  /** Changes per visitor (wrangler.toml's `ratelimits`); absent in tests that don't set it. */
  DEMO_LIMITER?: RateLimit;
};

const VOCABULARY_MS = 10 * 60_000;
let vocabulary: { words: Set<string>; until: number } | null = null;

/** Every word the demo has: the safe lists and each app's sample data, kept ten minutes. */
async function demoVocabulary(env: DemoEnv): Promise<Set<string>> {
  if (vocabulary && vocabulary.until > Date.now()) return vocabulary.words;
  const words = baseVocabulary();
  await Promise.all(
    Object.entries(WORD_APPS).map(async ([app, binding]) => {
      try {
        const res = await env[binding].fetch(`http://${app}/api/internal/demo/words`);
        if (!res.ok) return;
        const body = (await res.json()) as { words?: string[] };
        for (const word of body.words ?? []) words.add(word);
      } catch (err) {
        // Without an app's words, text from its sample data is refused until the next try.
        console.error(`[gateway] demo words from ${app}`, err);
      }
    }),
  );
  vocabulary = { words, until: Date.now() + VOCABULARY_MS };
  return words;
}

/** A form field's value: the JSON in it, when it holds some (Scouting sends answers that way). */
function parsedOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const refuse = (status: number, error: string) =>
  Response.json({ error, code: "demo" }, { status });

/**
 * A request to the demo team's API for `app` at `path` (after /api): a refusal, or null to send it
 * on. Reads a copy of the body, so the request can still be sent.
 */
export async function checkDemoRequest(
  request: Request,
  env: DemoEnv,
  app: DemoWorker,
  path: string,
  search: URLSearchParams,
): Promise<Response | null> {
  const { method } = request;
  if (demoBlocked(app, method, path)) return refuse(403, DEMO_REFUSALS.blocked);
  if (!isWrite(method)) {
    return demoOutsideReadRefused(app, path, search) ? refuse(403, DEMO_REFUSALS.blocked) : null;
  }

  const visitor = request.headers.get("CF-Connecting-IP") ?? "local";
  if (env.DEMO_LIMITER) {
    const { success } = await env.DEMO_LIMITER.limit({ key: visitor });
    if (!success) return refuse(429, DEMO_REFUSALS.tooFast);
  }

  const words = await demoVocabulary(env);
  if (disallowedText([...search.values()], words) !== null) {
    return refuse(400, DEMO_REFUSALS.text);
  }

  if (request.body === null) return null;
  const type = request.headers.get("Content-Type") ?? "";
  // A form (Scouting's reports): its text is checked like JSON's, and any file in it refused.
  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    let form: FormData;
    try {
      form = await request.clone().formData();
    } catch {
      return refuse(400, "That form couldn't be read.");
    }
    // By field name, so the names are checked as keys (`teamName`) and the values as text.
    const fields: Record<string, unknown[]> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string") return refuse(415, DEMO_REFUSALS.upload);
      fields[key] = [...(fields[key] ?? []), parsedOrText(value)];
    }
    return disallowedText(fields, words) === null ? null : refuse(400, DEMO_REFUSALS.text);
  }
  if (!type.includes("application/json")) {
    // Nothing to read is fine (a DELETE); anything else is an upload.
    const text = type === "" ? await request.clone().text() : "x";
    return text.trim() === "" ? null : refuse(415, DEMO_REFUSALS.upload);
  }
  const text = await request.clone().text();
  if (text.trim() === "") return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "That request isn't valid JSON.");
  }
  return disallowedText(body, words) === null ? null : refuse(400, DEMO_REFUSALS.text);
}

/** Forget the words, so the next check asks the apps again (tests). */
export function forgetDemoVocabulary() {
  vocabulary = null;
}
