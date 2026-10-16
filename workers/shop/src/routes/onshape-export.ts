import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import type { Context } from "hono";
import { createShopDb } from "../db";
import {
  drawingExistsInR2,
  exportDrawingAsPDF,
  getDrawingExportParams,
  retrieveDrawingFromR2,
  storeDrawingInR2,
} from "../lib/onshape-export";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

/** A part revision's drawing: the team's copy in R2, else exported from the team's Onshape. */
const handleDrawingRequest = async (c: Context<AppEnv>) => {
  try {
    const partNumber = c.req.param("partNumber");
    const revision = c.req.param("revision");
    const teamId = c.get("teamId");

    if (!partNumber || !revision) {
      return c.json({ error: "Missing required parameters: partNumber or revision" }, 400);
    }

    let pdfBuffer: ArrayBuffer;

    if (await drawingExistsInR2(c.env, teamId, partNumber, revision)) {
      console.log("[OnShape Export] Drawing found in R2, retrieving", { partNumber, revision });
      pdfBuffer = await retrieveDrawingFromR2(c.env, teamId, partNumber, revision);
    } else {
      console.log("[OnShape Export] Drawing not in R2, exporting from OnShape", {
        partNumber,
        revision,
      });
      const params = await getDrawingExportParams(
        c.env,
        createShopDb(c.env.SHOP_DB),
        teamId,
        partNumber,
      );
      pdfBuffer = await exportDrawingAsPDF(
        params.documentId,
        params.versionId,
        params.drawingEntityId,
        params.credentials,
      );
      // Store in R2 for future requests
      await storeDrawingInR2(c.env, teamId, partNumber, revision, pdfBuffer);
    }

    return c.newResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=drawing.pdf",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    console.error("[OnShape Export Route Error]", err);
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to retrieve drawing" },
      500,
    );
  }
};

router.get("/drawings/export/:partNumber/:revision", requireAuth, handleDrawingRequest);

export const onshapeExportRouter = router;
