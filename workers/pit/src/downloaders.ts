import {
  TEAM_HEADER,
  inTeam,
  logTeamChange,
  requestTeamId,
  requireAuth,
  requireMentor,
  withTeam,
} from "@g3/auth";
import { desc, eq, gt, lt } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { createDb } from "./db";
import { logDownloaderCodes, logDownloaders } from "./db/schema";
import { teamNumberOf } from "./settings";
import type { AppEnv } from "./types";

// Log downloaders: computers running the pit log downloader (devices/pit-log-downloader), paired
// with the team's Pit like a kiosk is activated. A mentor or admin gets a 6-digit code on Pit's
// Logs page and types it into the downloader, which sends it here on the team's own address and
// gets a key of its own back, once. The downloader then sends `Authorization: Bearer <key>` to
// the routes behind `requireDownloader`; only the key's SHA-256 is kept.

/** How long a pairing code works, and how many wrong codes the team can try while it does. */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
const NAME_MAX = 60;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function hashKey(key: string) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))),
  );
}

/** A new downloader key: "pld_" and 43 random base64url characters. */
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `pld_${b64}`;
}

/** Six random digits. */
function newCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
}

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A paired downloader, by its key, on its own team's address: sets the team and
 * `downloaderId`, and notes when it was last heard from.
 */
export const requireDownloader = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return c.json({ error: "Unauthorized." }, 401);
  const teamId = requestTeamId(c);
  const db = createDb(c.env.PIT_DB);
  const found = await db
    .select({ id: logDownloaders.id })
    .from(logDownloaders)
    .where(inTeam(logDownloaders, teamId, eq(logDownloaders.keyHash, await hashKey(key))))
    .get();
  if (!found) return c.json({ error: "Unauthorized." }, 401);
  c.set("teamId", teamId);
  c.set("downloaderId", found.id);
  await db
    .update(logDownloaders)
    .set({ lastSeenAt: Date.now() })
    .where(inTeam(logDownloaders, teamId, eq(logDownloaders.id, found.id)));
  await next();
});

/** The team's paired downloaders, as Pit's Logs page lists them (never a key's hash). */
export type LogDownloader = {
  id: number;
  name: string;
  keyHint: string;
  pairedByName: string;
  pairedAt: number;
  lastSeenAt: number | null;
};

const listColumns = {
  id: logDownloaders.id,
  name: logDownloaders.name,
  keyHint: logDownloaders.keyHint,
  pairedByName: logDownloaders.pairedByName,
  pairedAt: logDownloaders.pairedAt,
  lastSeenAt: logDownloaders.lastSeenAt,
};

/** Pit's side: list, get a pairing code, remove (`/downloaders`). */
export const downloaderRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const downloaders: LogDownloader[] = await db
      .select(listColumns)
      .from(logDownloaders)
      .where(inTeam(logDownloaders, c.get("teamId")))
      .orderBy(desc(logDownloaders.pairedAt));
    return c.json({
      downloaders,
      canManage: c.get("userIsMentor") || c.get("userIsAdmin"),
    });
  })

  // A new pairing code for the team, replacing any it had.
  .post("/codes", requireMentor, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const now = Date.now();
    const code = newCode();
    const expiresAt = now + CODE_TTL_MS;
    await db.batch([
      db.delete(logDownloaderCodes).where(inTeam(logDownloaderCodes, teamId)),
      db.insert(logDownloaderCodes).values(
        withTeam(teamId, {
          code,
          createdBy: c.get("userId"),
          createdByName: c.get("userDisplayName"),
          createdAt: now,
          expiresAt,
        }),
      ),
    ]);
    return c.json({ code, expiresAt }, 201);
  })

  // The downloader trades a code for its key. No session: the code is the proof, and the team is
  // the address it came in on.
  .post("/pair", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      code?: unknown;
      name?: unknown;
    } | null;
    const code = typeof body?.code === "string" ? body.code.replace(/\s/g, "") : "";
    const name =
      typeof body?.name === "string" ? body.name.trim().slice(0, NAME_MAX) : "Pit computer";
    if (!/^\d{6}$/.test(code)) return c.json({ error: "The code is 6 digits." }, 400);

    const teamId = requestTeamId(c);
    const db = createDb(c.env.PIT_DB);
    const now = Date.now();
    // Taken in one statement, so a code pairs one downloader however many try it at once.
    const [used] = await db
      .delete(logDownloaderCodes)
      .where(
        inTeam(
          logDownloaderCodes,
          teamId,
          eq(logDownloaderCodes.code, code),
          gt(logDownloaderCodes.expiresAt, now),
          lt(logDownloaderCodes.attempts, MAX_ATTEMPTS),
        ),
      )
      .returning();
    if (!used) {
      await db
        .update(logDownloaderCodes)
        .set({ attempts: (await currentAttempts(db, teamId, now)) + 1 })
        .where(inTeam(logDownloaderCodes, teamId, gt(logDownloaderCodes.expiresAt, now)));
      return c.json(
        { error: "That code isn't right, or it has expired. Get a new one on Pit's Logs page." },
        400,
      );
    }

    const key = newKey();
    const [downloader] = await db
      .insert(logDownloaders)
      .values(
        withTeam(teamId, {
          name: name || "Pit computer",
          keyHash: await hashKey(key),
          keyHint: key.slice(-4),
          pairedBy: used.createdBy,
          pairedByName: used.createdByName,
          pairedAt: now,
          lastSeenAt: now,
        }),
      )
      .returning({ id: logDownloaders.id, name: logDownloaders.name });
    await logTeamChange(c.env, teamId, {
      userId: used.createdBy,
      app: "pit",
      what: "Log downloader paired",
      changed: ["Log downloaders"],
    });
    return c.json(
      { id: downloader.id, name: downloader.name, key, teamNumber: teamNumberOf(teamId) },
      201,
    );
  })

  .delete("/:id", requireMentor, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const [removed] = await db
      .delete(logDownloaders)
      .where(inTeam(logDownloaders, teamId, eq(logDownloaders.id, id)))
      .returning({ id: logDownloaders.id });
    if (!removed) return c.json({ error: "Log downloader not found." }, 404);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "pit",
      what: "Log downloader removed",
      changed: ["Log downloaders"],
    });
    return c.json({ ok: true });
  });

async function currentAttempts(db: ReturnType<typeof createDb>, teamId: string, now: number) {
  const row = await db
    .select({ attempts: logDownloaderCodes.attempts })
    .from(logDownloaderCodes)
    .where(inTeam(logDownloaderCodes, teamId, gt(logDownloaderCodes.expiresAt, now)))
    .get();
  return row?.attempts ?? 0;
}

/** The downloader's side, with its key (`/downloader`). */
export const downloaderSelfRoutes = new Hono<AppEnv>()
  // Whether its key still works, and what it's paired as.
  .get("/me", requireDownloader, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    const me = await db
      .select({
        id: logDownloaders.id,
        name: logDownloaders.name,
        pairedAt: logDownloaders.pairedAt,
      })
      .from(logDownloaders)
      .where(inTeam(logDownloaders, teamId, eq(logDownloaders.id, c.get("downloaderId"))))
      .get();
    if (!me) return c.json({ error: "Unauthorized." }, 401);
    return c.json({ ...me, teamNumber: teamNumberOf(teamId) });
  })

  // The team's appearance (colors, names, logo), for the downloader's status page: from G3ID's
  // public /team/ui for the downloader's team, so the downloader only ever talks to its Pit.
  .get("/team-ui", requireDownloader, async (c) => {
    const res = await c.env.G3ID.fetch(
      new Request("http://g3id/api/team/ui", { headers: { [TEAM_HEADER]: c.get("teamId") } }),
    ).catch(() => null);
    if (!res?.ok) return c.json({ error: "The team's appearance isn't available right now." }, 502);
    return c.json(await res.json());
  })

  // Unpairing from the downloader's own page.
  .delete("/me", requireDownloader, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const teamId = c.get("teamId");
    await db
      .delete(logDownloaders)
      .where(inTeam(logDownloaders, teamId, eq(logDownloaders.id, c.get("downloaderId"))));
    await logTeamChange(c.env, teamId, {
      userId: null,
      app: "pit",
      what: "Log downloader unpaired itself",
      changed: ["Log downloaders"],
    });
    return c.json({ ok: true });
  });
