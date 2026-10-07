import { requireAuth } from "@g3/auth";
import { type Context, Hono } from "hono";
import { drawingKey } from "../lib/storage";
import type { AppEnv } from "../types";

/**
 * Sends a document to the shop printer through the edge box (workers/edge →
 * tunnel → CUPS on the box). Shop prints are always one-sided black and white
 * on the default printer, as the logged-in user.
 */
async function sendToPrinter(
  c: Context<AppEnv>,
  title: string,
  contentType: string,
  body: BodyInit | null,
) {
  try {
    const query = new URLSearchParams({ title, sides: "one-sided", color: "monochrome" });
    const res = await c.env.EDGE.fetch(
      new Request(`http://edge/api/print/jobs?${query}`, {
        method: "POST",
        headers: { cookie: c.req.header("Cookie") ?? "", "content-type": contentType },
        body,
      }),
    );
    const data = (await res.json()) as {
      ok?: boolean;
      jobId?: number;
      error?: string;
      alerts?: { severity: "error" | "warning"; message: string }[];
    };
    // Signed in here but not by Edge: the box isn't this team's (it's the site team's until each
    // team can pair its own, roadmap E.1/E.2).
    if (res.status === 401 || res.status === 403) {
      return c.json(
        {
          ok: false as const,
          error: "Printing needs an edge box, and your team hasn't connected one.",
        },
        503,
      );
    }
    if (!res.ok || !data.ok) {
      return c.json(
        { ok: false as const, error: data.error || "Print failed" },
        res.status >= 500 ? (res.status as 502 | 503) : 400,
      );
    }
    // The job is queued, but it won't come out until a printer problem (out of
    // paper, jam, ...) is fixed. Minor ones like "toner is low" are left out.
    const problems = (data.alerts ?? [])
      .filter((a) => a.severity === "error")
      .map((a) => a.message);
    const warning = problems.length
      ? `The printer needs attention: ${problems.join(", ")}. It'll print once that's fixed.`
      : null;
    return c.json({ ok: true as const, jobId: String(data.jobId), warning });
  } catch (err) {
    console.error("[Print Error]", err);
    return c.json(
      { ok: false as const, error: err instanceof Error ? err.message : "Print request failed" },
      500,
    );
  }
}

/** Response: { ok: true, jobId } or { ok: false, error }. */
export const printRouter = new Hono<AppEnv>()
  // Body: the file (PDF or plain text); query: `title`.
  .post("/", requireAuth, (c) =>
    sendToPrinter(
      c,
      c.req.query("title") ?? "Shop print",
      c.req.header("Content-Type") ?? "application/pdf",
      c.req.raw.body,
    ),
  )
  // Prints a part revision's released drawing straight from R2 (already
  // barcode-stamped at export), so the PDF crosses the shop's metered hotspot
  // once, to the box, instead of down to the kiosk and back up again.
  .post("/drawing/:partNumber/:revision", requireAuth, async (c) => {
    const { partNumber, revision } = c.req.param();
    const file = await c.env.DRAWINGS.get(drawingKey(c.get("teamId"), partNumber, revision));
    if (!file) {
      return c.json({ ok: false as const, error: "There's no drawing for this revision." }, 404);
    }
    // Drawings are a few MB at most; read it whole, like the drawing route does.
    return sendToPrinter(
      c,
      `${partNumber} Rev ${revision}`,
      "application/pdf",
      await file.arrayBuffer(),
    );
  });
