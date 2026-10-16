import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { drawingKey } from "../lib/storage";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

/** A part revision's drawing as the team has it in R2 (whether or not the part is defined). */
router.get("/parts/:partNumber/:revision/drawing", requireAuth, async (c) => {
  try {
    const partNumber = c.req.param("partNumber");
    const revision = c.req.param("revision");

    if (!partNumber || !revision) {
      return c.json({ error: "Missing part number or revision" }, 400);
    }

    const file = await c.env.DRAWINGS.get(drawingKey(c.get("teamId"), partNumber, revision));

    if (!file) {
      return c.json(
        {
          error: "Drawing not available",
          details: `No cached drawing found for part "${partNumber}" revision "${revision}".`,
        },
        404,
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    return c.newResponse(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=drawing.pdf",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    console.error("[Part Viewer Error]", err);
    return c.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : "An unexpected error occurred",
      },
      500,
    );
  }
});

export const partViewerRouter = router;
