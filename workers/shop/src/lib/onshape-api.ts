import { inTeam, withTeam } from "@g3/auth";
import {
  type SQL,
  and,
  countDistinct,
  desc,
  eq,
  gte,
  lt,
  max,
  min,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { createShopDb } from "../db";
import * as schema from "../db/schema";
import { type OnshapeCredentials, basicAuth } from "./onshape-config";

// Every call Shop makes to Onshape's API goes through `onshapeFetch`, which counts it for the
// team (onshape_api_usage: per API key, day and kind) and keeps the failed ones
// (onshape_api_errors, the last 50). The Admin page shows the counts (`usageReport`), for the
// team's current keys or all it has used; the pages show a banner under the bar while Onshape
// refuses the current keys' calls (`onshapeProblem`).

type ShopDb = ReturnType<typeof createShopDb>;

const BASE = "https://cad.onshape.com/api";

/** What a call is for, as the Admin page names it. */
export const ONSHAPE_CALLS = {
  release_package: "Read a release",
  bom: "Read the assembly's BOM",
  drawing_export: "Start a drawing export",
  export_status: "Check a drawing export",
  export_download: "Download a drawing",
  webhook_list: "List webhooks",
  webhook_create: "Register the webhook",
  webhook_delete: "Delete a webhook",
  connection_check: "Check the connection",
} as const;

export type OnshapeCallKind = keyof typeof ONSHAPE_CALLS;

/** Enough to call Onshape as a team, and to count the call against it. */
export type OnshapeApi = { db: ShopDb; teamId: string; credentials: OnshapeCredentials };

/** Failed calls kept per team. */
const KEEP_ERRORS = 50;

const day = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Which API key a call was made with, without keeping the key: the start of its access key's
 * SHA-256. Saving new keys starts a new count; the old keys' calls are still there under "All".
 */
export async function keyId(credentials: OnshapeCredentials) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credentials.apiKey));
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Onshape's own words for a failed call (its JSON `message`), else the start of the body. */
async function errorMessage(response: Response) {
  const body = await response.text().catch(() => "");
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 300);
  } catch {}
  return body.trim().slice(0, 300) || response.statusText || null;
}

async function record(
  api: OnshapeApi,
  kind: OnshapeCallKind,
  failure: { status: number; message: string | null } | null,
) {
  const { db, teamId } = api;
  const key = await keyId(api.credentials);
  const now = new Date();
  // Milliseconds, so a success and a failure a moment apart are still in order.
  const at = now.getTime();
  const t = schema.onshapeApiUsage;
  try {
    await db
      .insert(t)
      .values(
        withTeam(teamId, {
          keyId: key,
          day: day(now),
          kind,
          calls: 1,
          errors: failure ? 1 : 0,
          lastOkAt: failure ? null : at,
          lastErrorAt: failure ? at : null,
        }),
      )
      .onConflictDoUpdate({
        target: [t.teamId, t.keyId, t.day, t.kind],
        set: failure
          ? { calls: sql`${t.calls} + 1`, errors: sql`${t.errors} + 1`, lastErrorAt: at }
          : { calls: sql`${t.calls} + 1`, lastOkAt: at },
      });
    if (!failure) return;
    const e = schema.onshapeApiErrors;
    await db.insert(e).values(withTeam(teamId, { keyId: key, at, kind, ...failure }));
    const kept = db
      .select({ id: e.id })
      .from(e)
      .where(inTeam(e, teamId))
      .orderBy(desc(e.id))
      .limit(KEEP_ERRORS);
    await db.delete(e).where(inTeam(e, teamId, notInArray(e.id, kept)));
  } catch (err) {
    // Counting must never cost the call itself.
    console.error("[Onshape usage] Not recorded", kind, err);
  }
}

/**
 * Calls Onshape's API (`path` after /api, e.g. "/v16/webhooks") as the team, and counts it. A
 * failed answer is returned as it is; one that never came throws, as fetch does.
 */
export async function onshapeFetch(
  api: OnshapeApi,
  kind: OnshapeCallKind,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", basicAuth(api.credentials));
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (err) {
    await record(api, kind, {
      status: 0,
      message: err instanceof Error ? err.message : "Onshape couldn't be reached",
    });
    throw err;
  }
  await record(
    api,
    kind,
    response.ok ? null : { status: response.status, message: await errorMessage(response.clone()) },
  );
  return response;
}

/** An answer that means Onshape won't take any of the team's calls, not just this one. */
const isServiceWide = (status: number) =>
  status === 0 ||
  status === 401 ||
  status === 402 ||
  status === 403 ||
  status === 429 ||
  status >= 500;

export type OnshapeProblem = {
  kind: OnshapeCallKind;
  status: number;
  message: string | null;
  /** Unix milliseconds. */
  at: number;
};

/**
 * Why Onshape isn't working for the team right now: the current keys' latest call failed in a way
 * that stops every call (keys refused, the limit reached, Onshape down), and nothing has worked
 * since. Saving new keys clears it until they fail too.
 */
export async function onshapeProblem(
  db: ShopDb,
  teamId: string,
  credentials: OnshapeCredentials,
): Promise<OnshapeProblem | null> {
  const e = schema.onshapeApiErrors;
  const t = schema.onshapeApiUsage;
  const key = await keyId(credentials);
  const [latest, ok] = await Promise.all([
    db
      .select()
      .from(e)
      .where(inTeam(e, teamId, eq(e.keyId, key)))
      .orderBy(desc(e.at), desc(e.id))
      .get(),
    db
      .select({ at: max(t.lastOkAt) })
      .from(t)
      .where(inTeam(t, teamId, eq(t.keyId, key)))
      .get(),
  ]);
  if (!latest || !isServiceWide(latest.status)) return null;
  if (ok?.at && ok.at >= latest.at) return null;
  return {
    kind: latest.kind as OnshapeCallKind,
    status: latest.status,
    message: latest.message,
    at: latest.at,
  };
}

/**
 * The Admin page's numbers: calls and errors per day and kind over the last year (UTC days), the
 * totals before that per kind, and the latest failed calls. With `onlyCurrent`, only the calls
 * made with the `current` keys; without, every key the team has used. `keys` says whether there are other keys' calls to
 * show, and the first day the current keys were used.
 */
export async function usageReport(
  db: ShopDb,
  teamId: string,
  current: OnshapeCredentials | null,
  onlyCurrent: boolean,
) {
  const t = schema.onshapeApiUsage;
  const e = schema.onshapeApiErrors;
  const key = current ? await keyId(current) : null;
  const usageOf = (...conditions: (SQL | undefined)[]) =>
    inTeam(t, teamId, and(onlyCurrent ? eq(t.keyId, key ?? "") : undefined, ...conditions));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 365);
  const from = day(since);
  const [days, older, errors, mine, others] = await Promise.all([
    db
      .select({
        day: t.day,
        kind: t.kind,
        calls: sql<number>`sum(${t.calls})`,
        errors: sql<number>`sum(${t.errors})`,
      })
      .from(t)
      .where(usageOf(gte(t.day, from)))
      .groupBy(t.day, t.kind)
      .orderBy(t.day),
    db
      .select({
        kind: t.kind,
        calls: sql<number>`sum(${t.calls})`,
        errors: sql<number>`sum(${t.errors})`,
      })
      .from(t)
      .where(usageOf(lt(t.day, from)))
      .groupBy(t.kind),
    db
      .select({ at: e.at, kind: e.kind, status: e.status, message: e.message })
      .from(e)
      .where(inTeam(e, teamId, onlyCurrent ? eq(e.keyId, key ?? "") : undefined))
      .orderBy(desc(e.at), desc(e.id)),
    db
      .select({ since: min(t.day) })
      .from(t)
      .where(inTeam(t, teamId, eq(t.keyId, key ?? "")))
      .get(),
    db
      .select({ n: countDistinct(t.keyId) })
      .from(t)
      .where(inTeam(t, teamId, ne(t.keyId, key ?? "")))
      .get(),
  ]);
  return {
    kinds: ONSHAPE_CALLS,
    today: day(new Date()),
    keys: {
      onlyCurrent,
      /** The first day (UTC) the current keys made a call; null before they've made one. */
      currentSince: mine?.since ?? null,
      /** Keys the team used before these. */
      others: others?.n ?? 0,
    },
    days: days.map((d) => ({ ...d, calls: Number(d.calls), errors: Number(d.errors) })),
    older: older.map((o) => ({ ...o, calls: Number(o.calls), errors: Number(o.errors) })),
    errors,
  };
}
