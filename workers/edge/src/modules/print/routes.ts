import { requireAdmin, requireAuth } from "@g3/auth";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { AgentError, agentFetch } from "../../lib/agent";
import type { AppEnv } from "../../types";
import {
  type DiscoveredPrinter,
  MAX_PRINT_BYTES,
  PRINT_CONTENT_TYPES,
  type PrintJob,
  type Printer,
  type PrinterAlert,
  isValidDeviceUri,
  isValidPrinterName,
  parsePrintOptions,
} from "./types";

type Ctx = Context<AppEnv>;

/**
 * Forwards a request to the agent's print API and relays the result. Nothing
 * is stored here: CUPS on the box holds the printers and the queue, and if the
 * box is unreachable the request fails right away.
 */
async function relay<T>(c: Ctx, path: string, init?: Parameters<typeof agentFetch>[2]) {
  try {
    const res = await agentFetch(c.env, `/print${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return {
        error: body.error ?? `Print server error (HTTP ${res.status}).`,
        status: res.status === 400 ? 400 : 502,
      } as const;
    }
    return { data: body } as const;
  } catch (err) {
    if (err instanceof AgentError) return { error: err.message, status: err.status } as const;
    throw err;
  }
}

/** G3ID display names for user ids (job owners). */
async function userNames(c: Ctx, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const res = await c.env.G3ID.fetch(
    new Request(`http://g3id/api/auth/users?ids=${encodeURIComponent(ids.join(","))}`, {
      headers: { cookie: c.req.header("Cookie") ?? "" },
    }),
  );
  if (!res.ok) return new Map<string, string>();
  const users = (await res.json()) as { id: string; displayName: string }[];
  return new Map(users.map((u) => [u.id, u.displayName]));
}

const printerParam = (c: Ctx) => {
  const name = c.req.param("name") ?? "";
  return isValidPrinterName(name) ? name : null;
};

export const printRouter = new Hono<AppEnv>()
  .get("/printers", requireAuth, async (c) => {
    const r = await relay<{ printers: Printer[] }>(c, "/printers");
    if ("error" in r) return c.json({ error: r.error }, r.status);
    return c.json({ printers: r.data.printers });
  })
  .get("/jobs", requireAuth, async (c) => {
    const r = await relay<{ jobs: PrintJob[] }>(c, "/jobs");
    if ("error" in r) return c.json({ error: r.error }, r.status);
    const names = await userNames(c, [
      ...new Set(r.data.jobs.map((j) => j.user).filter((u): u is string => !!u)),
    ]);
    const me = c.get("userId");
    const admin = c.get("userIsAdmin");
    return c.json({
      jobs: r.data.jobs.map((j) => ({
        ...j,
        userName: j.user ? (names.get(j.user) ?? null) : null,
        canCancel: admin || j.user === me,
      })),
    });
  })
  // Print a document. The body is the file; options are query parameters
  // (title, printer, copies, sides, color, media, pageRanges). The shop worker
  // calls this through a service binding with the user's cookie.
  .post("/jobs", requireAuth, async (c) => {
    const options = parsePrintOptions({ ...c.req.query(), user: undefined });
    if (typeof options === "string") return c.json({ ok: false, error: options }, 400);
    const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!PRINT_CONTENT_TYPES.includes(type as never)) {
      return c.json(
        { ok: false, error: "Only PDF, plain text, JPEG, and PNG files can be printed." },
        400,
      );
    }
    const length = Number(c.req.header("Content-Length") ?? 0);
    if (length > MAX_PRINT_BYTES)
      return c.json({ ok: false, error: "The file is too large (50 MB max)." }, 400);

    const query = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...options, user: c.get("userId") })) {
      if (v !== undefined) query.set(k, String(v));
    }
    const r = await relay<{ ok: true; jobId: number; printer: string; alerts?: PrinterAlert[] }>(
      c,
      `/jobs?${query}`,
      {
        method: "POST",
        headers: { "Content-Type": type },
        body: c.req.raw.body,
        timeoutMs: 60_000,
      },
    );
    if ("error" in r) return c.json({ ok: false, error: r.error }, r.status);
    // alerts: problems with the printer right now (e.g. out of paper); the job is still queued.
    return c.json({
      ok: true,
      jobId: r.data.jobId,
      printer: r.data.printer,
      alerts: r.data.alerts ?? [],
    });
  })
  .delete("/jobs/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.json({ error: "Invalid job id." }, 400);
    if (!c.get("userIsAdmin")) {
      // Members can cancel their own jobs only.
      const list = await relay<{ jobs: PrintJob[] }>(c, "/jobs");
      if ("error" in list) return c.json({ error: list.error }, list.status);
      const job = list.data.jobs.find((j) => j.id === id);
      if (!job || job.user !== c.get("userId")) {
        return c.json({ error: "You can only cancel your own print jobs." }, 403);
      }
    }
    // A job on a stuck printer can take a while to stop.
    const r = await relay(c, `/jobs/${id}`, { method: "DELETE", timeoutMs: 90_000 });
    if ("error" in r) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true });
  })
  // Admin: find printers on the shop network (mDNS/DNS-SD), takes ~10s.
  .post("/discover", requireAdmin, async (c) => {
    const r = await relay<{ printers: DiscoveredPrinter[] }>(c, "/discover", {
      method: "POST",
      timeoutMs: 45_000,
    });
    if ("error" in r) return c.json({ error: r.error }, r.status);
    return c.json({ printers: r.data.printers });
  })
  .post(
    "/printers",
    requireAdmin,
    validator("json", (value, c) => {
      const v = (value ?? {}) as Record<string, unknown>;
      const text = (x: unknown) => (typeof x === "string" ? x : undefined);
      const out: {
        name: string;
        uri: string;
        description?: string;
        location?: string;
        makeDefault: boolean;
      } = {
        name: text(v.name) ?? "",
        uri: text(v.uri) ?? "",
        description: text(v.description),
        location: text(v.location),
        makeDefault: v.makeDefault === true,
      };
      if (!isValidPrinterName(out.name)) {
        return c.json({ error: "Name must be 1-64 letters, numbers, - or _." }, 400);
      }
      if (!isValidDeviceUri(out.uri)) return c.json({ error: "Invalid printer address." }, 400);
      return out;
    }),
    async (c) => {
      // Setting up a driverless queue asks the printer for its capabilities, which can be slow.
      const r = await relay(c, "/printers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c.req.valid("json")),
        timeoutMs: 90_000,
      });
      if ("error" in r) return c.json({ error: r.error }, r.status);
      return c.json({ ok: true });
    },
  )
  .delete("/printers/:name", requireAdmin, async (c) => {
    const name = printerParam(c);
    if (!name) return c.json({ error: "Invalid printer name." }, 400);
    // Removing a printer first stops its current job, which can be slow.
    const r = await relay(c, `/printers/${name}`, { method: "DELETE", timeoutMs: 90_000 });
    if ("error" in r) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true });
  })
  .post("/printers/:name/:action{default|resume|test}", requireAdmin, async (c) => {
    const name = printerParam(c);
    if (!name) return c.json({ error: "Invalid printer name." }, 400);
    // Longer than the agent's own 75s limit on CUPS commands, so its clearer error wins.
    const r = await relay(c, `/printers/${name}/${c.req.param("action")}`, {
      method: "POST",
      timeoutMs: 90_000,
    });
    if ("error" in r) return c.json({ error: r.error }, r.status);
    return c.json({ ok: true });
  });
