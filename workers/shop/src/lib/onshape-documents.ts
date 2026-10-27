import { inTeam } from "@g3/auth";
import { desc, eq } from "drizzle-orm";
import type { ShopDb } from "../db";
import { onshapeDocuments, onshapeParts, onshapeReleases } from "../db/schema";

// The Onshape documents a team follows (migration 0025), each linked to one project. Shop's
// webhook is registered on each; a release goes to the project of the document it came from, and
// keeps it (`onshape_releases.project_id`) when the document is later taken off the list.

export type OnshapeDocument = typeof onshapeDocuments.$inferSelect;

/** Every document the team follows, in the order they were added. */
export const teamDocuments = (db: ShopDb, teamId: string) =>
  db
    .select()
    .from(onshapeDocuments)
    .where(inTeam(onshapeDocuments, teamId))
    .orderBy(onshapeDocuments.id)
    .all();

/** The team's row for an Onshape document id, if it follows that document. */
export const followedDocument = (db: ShopDb, teamId: string, documentId: string) =>
  db
    .select()
    .from(onshapeDocuments)
    .where(inTeam(onshapeDocuments, teamId, eq(onshapeDocuments.documentId, documentId)))
    .get();

/**
 * The newest release record of a part number, with the document it came from: where to export
 * its drawing from. A part whose release hasn't arrived yet is taken to be in the team's document
 * when it follows only one. Null when nothing holds the part number.
 */
export async function latestReleasedPart(db: ShopDb, teamId: string, partNumber: string) {
  const row = await db
    .select({ part: onshapeParts, documentId: onshapeReleases.documentId })
    .from(onshapeParts)
    .leftJoin(
      onshapeReleases,
      inTeam(onshapeReleases, teamId, eq(onshapeReleases.id, onshapeParts.releaseId)),
    )
    .where(inTeam(onshapeParts, teamId, eq(onshapeParts.partNumber, partNumber)))
    .orderBy(desc(onshapeParts.createdAt))
    .get();
  if (!row) return null;
  let documentId = row.documentId;
  if (!documentId) {
    const documents = await teamDocuments(db, teamId);
    documentId = documents.length === 1 ? documents[0].documentId : null;
  }
  return { ...row.part, documentId };
}
